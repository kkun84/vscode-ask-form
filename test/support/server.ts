import { Effect, Fiber, Layer, Ref, Schedule, type Scope } from "effect"
import { McpClient, McpProtocol, type McpSchema } from "effect/ai"
import { FetchHttpClient } from "effect/http"
import { serveForms } from "../../src/mcp/http.ts"
import { ChatPostFailed, ChatPoster, WaitingIndicator, type ChatPost } from "../../src/mcp/ports.ts"
import { FormHtml } from "../../src/mcp/server.ts"

export interface Harness {
  readonly url: string
  readonly token: string
  readonly client: McpClient.McpClient
  readonly posts: Ref.Ref<ReadonlyArray<ChatPost>>
  readonly waiting: Ref.Ref<ReadonlyArray<number>>
  readonly tool: (name: string) => Effect.Effect<McpSchema.Tool>
  readonly call: (name: string, args: Record<string, unknown>) => Effect.Effect<McpSchema.CallToolResult>
  readonly waitUntil: (count: number) => Effect.Effect<void>
}

export const testHtml = "<!doctype html><html><head></head><body>form</body></html>"

export const harness = (options: { readonly failPosting?: boolean } = {}): Effect.Effect<Harness, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const posts = yield* Ref.make<ReadonlyArray<ChatPost>>([])
    const waiting = yield* Ref.make<ReadonlyArray<number>>([])
    const token = "test-token"
    const services = Layer.mergeAll(
      Layer.succeed(
        ChatPoster,
        ChatPoster.of({
          post: (post) =>
            options.failPosting === true ? Effect.fail(new ChatPostFailed("chat unavailable")) : Ref.update(posts, (all) => [...all, post])
        })
      ),
      Layer.succeed(
        WaitingIndicator,
        WaitingIndicator.of({
          update: (count) => Ref.update(waiting, (all) => [...all, count])
        })
      ),
      Layer.succeed(FormHtml, testHtml)
    )
    const { url } = yield* serveForms({ token, version: "0.0.0-test", services })
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
    const waitUntil = (count: number) =>
      Ref.get(waiting).pipe(
        Effect.flatMap((all) => (all.at(-1) === count ? Effect.void : Effect.fail("not yet"))),
        Effect.retry({ times: 500, schedule: Schedule.spaced("5 millis") }),
        Effect.orDie
      )
    return { url, token, client, posts, waiting, tool, call, waitUntil }
  })

export const runScoped = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

export const forkCall = (h: Harness, name: string, args: Record<string, unknown>) => Effect.forkChild(h.call(name, args))

export { Fiber }
