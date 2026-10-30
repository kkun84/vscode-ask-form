import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Readable, promises as streams } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { Effect, Layer, Schema, type Scope } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { HttpRouter } from "effect/http"
import { PendingFormsLive } from "./pending.ts"
import type { ChatPoster, WaitingIndicator } from "./ports.ts"
import { FormsServer, type FormHtml } from "./server.ts"

export interface FormsServerOptions {
  readonly token: string
  readonly version: string
  readonly services: Layer.Layer<ChatPoster | WaitingIndicator | FormHtml>
}

export interface RunningFormsServer {
  readonly url: string
}

export class FormsListenFailed extends Schema.TaggedError<FormsListenFailed, { readonly brand: unique symbol }>()("FormsListenFailed", {
  message: Schema.String,
  cause: Schema.Unknown
}) {}

const instructions =
  "Use ask_form to confirm several interdependent assumptions at once through a prefilled interactive form. Prefer the built-in askQuestions tool for a single simple choice."

const appLayer = (options: FormsServerOptions) =>
  FormsServer.pipe(
    Layer.provideMerge(
      McpServer.layerHttp({
        name: "ask-form",
        version: options.version,
        instructions,
        path: "/mcp",
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18]
      })
    ),
    Layer.provide(PendingFormsLive),
    Layer.provide(options.services)
  )

const reject = (res: ServerResponse, status: number): void => {
  res.writeHead(status, { "content-type": "text/plain" }).end()
}

const toRequest = (req: IncomingMessage, origin: string, signal: AbortSignal): Request => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      headers.append(name, item)
    }
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method ?? "GET",
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {})
  })
}

const writeResponse = async (response: Response, res: ServerResponse): Promise<void> => {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  if (response.body === null) {
    res.end()
    return
  }
  await streams.pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), res)
}

const listen = (server: Server) =>
  Effect.callback<number, FormsListenFailed>((resume) => {
    const cleanup = () => {
      server.off("error", onError)
      server.off("listening", onListening)
    }
    const onError = (cause: unknown) => {
      cleanup()
      resume(Effect.fail(new FormsListenFailed({ message: cause instanceof Error ? cause.message : String(cause), cause })))
    }
    const onListening = () => {
      cleanup()
      resume(Effect.succeed((server.address() as AddressInfo).port))
    }
    server.once("error", onError)
    try {
      server.listen(0, "127.0.0.1", onListening)
    } catch (cause) {
      onError(cause)
    }
  })

export const serveForms = (options: FormsServerOptions): Effect.Effect<RunningFormsServer, FormsListenFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const web = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(appLayer(options), { disableLogger: true })),
      (handler) => Effect.promise(() => handler.dispose())
    )
    const server = createServer((req, res) => {
      if (req.headers.origin !== undefined) {
        reject(res, 403)
        return
      }
      if (req.headers.authorization !== `Bearer ${options.token}`) {
        reject(res, 401)
        return
      }
      const controller = new AbortController()
      res.on("close", () => {
        if (!res.writableFinished) {
          controller.abort()
        }
      })
      const address = server.address() as AddressInfo
      const request = toRequest(req, `http://127.0.0.1:${address.port}`, controller.signal)
      web
        .handler(request)
        .then((response) => writeResponse(response, res))
        .catch(() => {
          if (res.headersSent) {
            res.end()
          } else {
            reject(res, 500)
          }
        })
    })
    const port = yield* Effect.acquireRelease(listen(server), () =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections()
        server.close(() => resume(Effect.void))
      })
    )
    return { url: `http://127.0.0.1:${port}/mcp` }
  })
