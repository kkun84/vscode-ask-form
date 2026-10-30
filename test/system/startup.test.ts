import assert from "node:assert/strict"
import { Server } from "node:http"
import { fileURLToPath } from "node:url"
import { it } from "node:test"
import { createVscode, fakeContext, loadBundle } from "../support/vscode-stub.ts"

it("SPEC-EXT-001 待ち受けの失敗は起動の失敗として返し、MCPサーバーを登録しない", async (context) => {
  context.mock.method(Server.prototype, "listen", function (this: Server) {
    assert.ok(this.listenerCount("error") > 0)
    queueMicrotask(() => this.emit("error", new Error("listen blocked")))
    return this
  })
  const { vscode, recorder } = createVscode()
  const extension = fakeContext()
  context.after(extension.dispose)
  const entry = loadBundle(fileURLToPath(new URL("../../dist/node/extension.cjs", import.meta.url)), vscode, "node")
  await assert.rejects(Promise.resolve(entry.activate(extension.context)), /listen blocked/)
  assert.equal(recorder.providers.size, 0)
})
