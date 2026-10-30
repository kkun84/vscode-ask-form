import assert from "node:assert/strict"
import { it } from "node:test"
import { Effect, Result } from "effect"
import type * as Vscode from "vscode"
import { AttachmentStore, AttachmentStoreFailed } from "../../src/mcp/ports.ts"
import { withVscode } from "../support/source.ts"
import { createVscode } from "../support/vscode-stub.ts"

it("DES-CHAT-001 デスクトップの添付を共有のファイル保存処理で永続化し、再作成した保存先から読み取る", async (context) => {
  const { vscode, recorder } = createVscode()
  const { attachmentStore } = await withVscode(vscode, () => import("../../src/extension/node/attachments.ts"))
  const api = vscode as typeof Vscode
  const storage = api.Uri.parse("/storage")
  const id = crypto.randomUUID()
  const name = "回答.json"
  const body = JSON.stringify({ title: "回答", values: { attendees: 150 } })
  const run = <A, E>(operation: (store: typeof AttachmentStore.Service) => Effect.Effect<A, E>) =>
    Effect.runPromise(Effect.flatMap(AttachmentStore, operation).pipe(Effect.provide(attachmentStore(storage))))
  await run((store) => store.write(id, name, body))
  assert.equal(recorder.files.get(`/storage/answers/${id}/${name}`), body)
  assert.equal(await run((store) => store.read(id, name)), body)
  assert.deepEqual(recorder.commands, [])
  const missing = await run((store) => Effect.result(store.read(id, "missing.json")))
  assert.ok(Result.isFailure(missing))
  assert.ok(missing.failure instanceof AttachmentStoreFailed)
  context.mock.method(api.workspace.fs, "writeFile", () => Promise.reject(new Error("disk full")))
  const failed = await run((store) => Effect.result(store.write(crypto.randomUUID(), name, body)))
  assert.ok(Result.isFailure(failed))
  assert.equal(failed.failure.message, "disk full")
})
