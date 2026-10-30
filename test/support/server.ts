import { Effect, Layer, Ref, Schedule, type Scope } from "effect"
import { McpClient, McpProtocol, type McpSchema } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { serveForms } from "../../src/mcp/http.ts"
import { AttachmentStore, WaitingIndicator } from "../../src/mcp/ports.ts"
import { FormHtml } from "../../src/mcp/server.ts"
import { memoryAttachments } from "./attachments.ts"

export interface Harness {
  readonly url: string
  readonly token: string
  readonly client: McpClient.McpClient
  readonly waiting: Ref.Ref<ReadonlyArray<number>>
  readonly tool: (name: string) => Effect.Effect<McpSchema.Tool>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<McpSchema.CallToolResult>
  readonly waitUntil: (count: number) => Effect.Effect<void>
}

export interface Connection {
  readonly client: McpClient.McpClient
  readonly tool: (name: string) => Effect.Effect<McpSchema.Tool>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<McpSchema.CallToolResult>
}

export const connect = (url: string, token: string): Effect.Effect<Connection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* McpClient.make({ name: "system-test", version: "1.0.0" }).pipe(
      Effect.provideServiceEffect(
        McpClient.Transport,
        McpClient.http({ url, protocol: McpProtocol.v2025_11_25, headers: { authorization: `Bearer ${token}` } })
      ),
      Effect.provide(FetchHttpClient.layer)
    )
    const tool = (name: string) =>
      client.listTools().pipe(
        Effect.flatMap((tools) => {
          const found = tools.find((item) => item.name === name)
          return found === undefined ? Effect.die(`tool ${name} not found`) : Effect.succeed(found)
        }),
        Effect.orDie
      )
    const call = (name: string, args: Record<string, unknown>) =>
      tool(name).pipe(
        Effect.flatMap((found) => client.callTool({ tool: found, arguments: args })),
        Effect.catch((error) => {
          const result = (error as { readonly result?: McpSchema.CallToolResult }).result
          return result === undefined ? Effect.die(error) : Effect.succeed(result)
        })
      )
    return { client, tool, call }
  })

export const testHtml = "<!doctype html><html><head></head><body>form</body></html>"

interface HarnessOptions {
  readonly attachments?: typeof AttachmentStore.Service
  readonly onWaiting?: (count: number) => Effect.Effect<void>
}

const harness = (options: HarnessOptions = {}): Effect.Effect<Harness, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const waiting = yield* Ref.make<ReadonlyArray<number>>([])
    const token = "test-token"
    const services = Layer.mergeAll(
      Layer.succeed(AttachmentStore, options.attachments ?? memoryAttachments().store),
      Layer.succeed(
        WaitingIndicator,
        WaitingIndicator.of({
          update: (count) => Ref.update(waiting, (all) => [...all, count]).pipe(Effect.andThen(options.onWaiting?.(count) ?? Effect.void))
        })
      ),
      Layer.succeed(FormHtml, testHtml)
    )
    const { url } = yield* serveForms({ token, version: "0.0.0-test", services })
    const { client, tool, call } = yield* connect(url, token)
    const waitUntil = (count: number) =>
      Ref.get(waiting).pipe(
        Effect.flatMap((all) => (all.at(-1) === count ? Effect.void : Effect.fail("not yet"))),
        Effect.retry({ times: 500, schedule: Schedule.spaced("5 millis") }),
        Effect.orDie
      )
    return { url, token, client, waiting, tool, call, waitUntil }
  })

export const runScoped = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.orDie(effect)))

export const withHarness = <A>(body: (h: Harness) => Effect.Effect<A, unknown, Scope.Scope>, options: HarnessOptions = {}): Promise<A> =>
  runScoped(Effect.flatMap(harness(options), body))

export const structured = (result: McpSchema.CallToolResult): Record<string, unknown> =>
  (result.structuredContent ?? {}) as Record<string, unknown>

export const text = (result: McpSchema.CallToolResult): string =>
  result.content.map((item) => ("text" in item ? String(item.text) : "")).join("\n")
