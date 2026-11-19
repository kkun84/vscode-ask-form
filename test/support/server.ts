import { Effect, Layer, Ref, Schedule, type Scope } from "effect"
import { McpClient, McpProtocol, type McpSchema } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { serveForms } from "../../src/mcp/http.ts"
import type { CompiledForm, Outcome } from "../../src/core/form.ts"
import { FormPanel, UserPresence, WaitingIndicator } from "../../src/mcp/ports.ts"
import { FormHtml, resourceMimeType } from "../../src/mcp/server.ts"

export interface Harness {
  readonly url: string
  readonly token: string
  readonly client: McpClient.McpClient
  readonly waiting: Ref.Ref<ReadonlyArray<number>>
  readonly tool: (name: string) => Effect.Effect<McpSchema.Tool>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<McpSchema.CallToolResult>
  readonly waitUntil: (count: number) => Effect.Effect<void>
  readonly panels: Ref.Ref<ReadonlyArray<CompiledForm>>
}

export interface Connection {
  readonly client: McpClient.McpClient
  readonly tool: (name: string) => Effect.Effect<McpSchema.Tool>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<McpSchema.CallToolResult>
}

const appsCapability = { "io.modelcontextprotocol/ui": { mimeTypes: [resourceMimeType] } }

const declaringApps = (transport: McpClient.Transport): McpClient.Transport => ({
  ...transport,
  request: (message, tool) => {
    if (message.method !== "initialize") {
      return transport.request(message, tool)
    }
    const params = (message.params ?? {}) as Record<string, unknown>
    const capabilities = (params["capabilities"] ?? {}) as Record<string, unknown>
    return transport.request({ ...message, params: { ...params, capabilities: { ...capabilities, extensions: appsCapability } } }, tool)
  }
})

export const connect = (url: string, token: string, apps = true): Effect.Effect<Connection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* McpClient.make({ name: "system-test", version: "1.0.0" }).pipe(
      Effect.provideServiceEffect(
        McpClient.Transport,
        McpClient.http({ url, protocol: McpProtocol.v2025_11_25, headers: { authorization: `Bearer ${token}` } }).pipe(
          Effect.map((transport) => (apps ? declaringApps(transport) : transport))
        )
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
  readonly onWaiting?: (count: number) => Effect.Effect<void>
  readonly unavailable?: boolean
  readonly away?: Effect.Effect<void>
  readonly apps?: boolean
  readonly panel?: Effect.Effect<Outcome>
}

const harness = (options: HarnessOptions = {}): Effect.Effect<Harness, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const waiting = yield* Ref.make<ReadonlyArray<number>>([])
    const panels = yield* Ref.make<ReadonlyArray<CompiledForm>>([])
    const token = "test-token"
    const services = Layer.mergeAll(
      Layer.succeed(
        WaitingIndicator,
        WaitingIndicator.of({
          update: (count) => Ref.update(waiting, (all) => [...all, count]).pipe(Effect.andThen(options.onWaiting?.(count) ?? Effect.void))
        })
      ),
      Layer.succeed(
        UserPresence,
        UserPresence.of({ unavailable: Effect.succeed(options.unavailable ?? false), away: options.away ?? Effect.never })
      ),
      Layer.succeed(
        FormPanel,
        FormPanel.of({
          ask: (form) => Ref.update(panels, (all) => [...all, form]).pipe(Effect.andThen(options.panel ?? Effect.never))
        })
      ),
      Layer.succeed(FormHtml, testHtml)
    )
    const { url } = yield* serveForms({ token, version: "0.0.0-test", services })
    const { client, tool, call } = yield* connect(url, token, options.apps ?? true)
    const waitUntil = (count: number) =>
      Ref.get(waiting).pipe(
        Effect.flatMap((all) => (all.at(-1) === count ? Effect.void : Effect.fail("not yet"))),
        Effect.retry({ times: 500, schedule: Schedule.spaced("5 millis") }),
        Effect.orDie
      )
    return { url, token, client, waiting, tool, call, waitUntil, panels }
  })

export const runScoped = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.orDie(effect)))

export const withHarness = <A>(body: (h: Harness) => Effect.Effect<A, unknown, Scope.Scope>, options: HarnessOptions = {}): Promise<A> =>
  runScoped(Effect.flatMap(harness(options), body))

export const structured = (result: McpSchema.CallToolResult): Record<string, unknown> =>
  (result.structuredContent ?? {}) as Record<string, unknown>

export const text = (result: McpSchema.CallToolResult): string =>
  result.content.map((item) => ("text" in item ? String(item.text) : "")).join("\n")
