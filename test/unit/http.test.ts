import assert from "node:assert/strict"
import { Server } from "node:http"
import { it, onTestFinished, vi } from "vitest"
import { Effect, Layer, Result } from "effect"
import { FormsListenFailed, serveForms } from "../../src/mcp/http.ts"
import { UserPresence, UserSettings, WaitingIndicator } from "../../src/mcp/ports.ts"
import { FormHtml } from "../../src/mcp/server.ts"

const services = Layer.mergeAll(
  Layer.succeed(WaitingIndicator, WaitingIndicator.of({ update: () => Effect.void })),
  Layer.succeed(UserPresence, UserPresence.of({ unavailable: Effect.succeed(false), away: Effect.never })),
  Layer.succeed(UserSettings, UserSettings.of({ commentPresets: Effect.undefined })),
  Layer.succeed(FormHtml, "")
)

for (const asynchronous of [true, false]) {
  it(`DES-HTTP-001 listenの${asynchronous ? "非同期" : "同期"}の失敗を型のある失敗にして受け口を片付ける`, async () => {
    const failure = new Error("listen EPERM")
    const servers: Array<Server> = []
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, ...args: ReadonlyArray<unknown>) {
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
