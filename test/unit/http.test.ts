import assert from "node:assert/strict"
import { Server } from "node:http"
import { it } from "node:test"
import { Effect, Layer, Result } from "effect"
import { FormsListenFailed, serveForms } from "../../src/mcp/http.ts"
import { ChatPoster, WaitingIndicator } from "../../src/mcp/ports.ts"
import { FormHtml } from "../../src/mcp/server.ts"

const services = Layer.mergeAll(
  Layer.succeed(ChatPoster, ChatPoster.of({ submit: Effect.void })),
  Layer.succeed(WaitingIndicator, WaitingIndicator.of({ update: () => Effect.void })),
  Layer.succeed(FormHtml, "")
)

for (const asynchronous of [true, false]) {
  it(`DES-HTTP-001 listenの${asynchronous ? "非同期" : "同期"}の失敗を型のある失敗にして受け口を片付ける`, async (context) => {
    const failure = new Error("listen EPERM")
    const servers: Array<Server> = []
    context.mock.method(Server.prototype, "listen", function (this: Server, ...args: ReadonlyArray<unknown>) {
      servers.push(this)
      assert.ok(this.listenerCount("error") > 0)
      const callback = args.at(-1)
      assert.equal(typeof callback, "function")
      this.once("listening", callback as () => void)
      if (asynchronous) {
        queueMicrotask(() => this.emit("error", failure))
        return this
      }
      throw failure
    })
    const result = await Effect.runPromise(Effect.scoped(Effect.result(serveForms({ token: "test", version: "test", services }))))
    assert.ok(Result.isFailure(result))
    assert.ok(result.failure instanceof FormsListenFailed)
    assert.equal(result.failure.cause, failure)
    assert.equal(servers[0]?.listenerCount("error"), 0)
    assert.deepEqual(servers[0]?.listeners("listening"), new Server().listeners("listening"))
  })
}
