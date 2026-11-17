import assert from "node:assert/strict"
import { posix } from "node:path"
import { it } from "node:test"
import type * as Vscode from "vscode"
import { withVscode } from "../support/source.ts"
import { createVscode } from "../support/vscode-stub.ts"

it("DES-CHAT-001 添付名を題名由来のまま保ち、同時の保存ごとに別のディレクトリと値を保持する", async (context) => {
  const { vscode, recorder } = createVscode()
  const { writeAttachment } = await withVscode(vscode, () => import("../../src/extension/shared/chat.ts"))
  const api = vscode as typeof Vscode
  const createDirectory = context.mock.method(api.workspace.fs, "createDirectory")
  const posts = [
    { title: "交流会の条件", name: "交流会の条件.json" },
    { title: "交流会の条件", name: "交流会の条件.json" },
    { title: "a b", name: "a-b.json" },
    { title: "a-b", name: "a-b.json" },
    { title: "!!!", name: "form.json" },
    { title: "???", name: "form.json" }
  ].map(({ title, name }, index) => ({ id: crypto.randomUUID(), name, body: JSON.stringify({ title, value: index }) }))
  await Promise.all(posts.map((post) => writeAttachment(api.Uri.parse("/storage"), post.id, post.name, post.body)))
  assert.equal(recorder.files.size, posts.length)
  const directories = createDirectory.mock.calls.map(({ arguments: [directory] }) => directory.path)
  assert.equal(new Set(directories).size, posts.length)
  for (const post of posts) {
    const path = `/storage/answers/${post.id}/${post.name}`
    assert.ok(directories.includes(posix.dirname(path)))
    assert.equal(recorder.files.get(path), post.body)
  }
})
