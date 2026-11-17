import assert from "node:assert/strict"
import { it } from "node:test"
import { Effect } from "effect"
import { AttachmentStore } from "../../src/mcp/ports.ts"
import { loadDesktopAttachments } from "../support/desktop-attachments.ts"

it("DES-CHAT-001 添付名を題名由来のまま保ち、同時の保存ごとに別のディレクトリと値を保持する", async (context) => {
  const { recorder, api, layer } = await loadDesktopAttachments()
  const createDirectory = context.mock.method(api.workspace.fs, "createDirectory")
  const posts = ["交流会の条件.json", "交流会の条件.json", "a-b.json", "a-b.json", "form.json", "form.json"].map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    body: JSON.stringify({ value: index })
  }))
  const writes = Effect.flatMap(AttachmentStore, (store) =>
    Effect.forEach(posts, (post) => store.write(post.id, post.name, post.body), { concurrency: "unbounded" })
  )
  await Effect.runPromise(writes.pipe(Effect.provide(layer)))
  assert.equal(recorder.files.size, posts.length)
  const directories = createDirectory.mock.calls.map(({ arguments: [directory] }) => directory.path)
  assert.equal(new Set(directories).size, posts.length)
  for (const post of posts) {
    assert.ok(directories.includes(`/storage/answers/${post.id}`))
    assert.equal(recorder.files.get(`/storage/answers/${post.id}/${post.name}`), post.body)
  }
})
