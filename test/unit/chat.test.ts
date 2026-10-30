import assert from "node:assert/strict"
import { posix } from "node:path"
import { it } from "node:test"
import type * as Vscode from "vscode"
import { withVscode } from "../support/source.ts"
import { createVscode } from "../support/vscode-stub.ts"

it("DES-CHAT-001 下書きとして入力欄に入れ、添付名を題名由来のまま保ち、同時投稿ごとに別のディレクトリと値を保持する", async (context) => {
  const { vscode, recorder } = createVscode()
  const { postToChat } = await withVscode(vscode, () => import("../../src/extension/shared/chat.ts"))
  const api = vscode as typeof Vscode
  const createDirectory = context.mock.method(api.workspace.fs, "createDirectory")
  const posts = [
    { title: "交流会の条件", name: "交流会の条件.json" },
    { title: "交流会の条件", name: "交流会の条件.json" },
    { title: "a b", name: "a-b.json" },
    { title: "a-b", name: "a-b.json" },
    { title: "!!!", name: "form.json" },
    { title: "???", name: "form.json" }
  ].map(({ title, name }, index) => ({
    title,
    name,
    text: `post-${index}`,
    values: { value: index }
  }))
  await Promise.all(posts.map((post) => postToChat(api.Uri.parse("/storage"), post)))
  assert.equal(recorder.files.size, posts.length)
  const directories = createDirectory.mock.calls.map(({ arguments: [directory] }) => directory.path)
  assert.equal(directories.length, posts.length)
  assert.equal(new Set(directories).size, posts.length)
  for (const post of posts) {
    const command = recorder.commands.find((entry) => (entry.args[0] as { readonly query: string }).query === post.text)
    assert.ok(command)
    const { attachFiles, isPartialQuery } = command.args[0] as {
      readonly attachFiles: ReadonlyArray<{ readonly path: string }>
      readonly isPartialQuery: boolean
    }
    assert.equal(isPartialQuery, true)
    const path = attachFiles[0]?.path ?? ""
    const directory = posix.dirname(path)
    assert.match(directory, /^\/storage\/answers\/[0-9a-f-]{36}$/)
    assert.ok(directories.includes(directory))
    assert.equal(posix.basename(path), post.name)
    assert.deepEqual(JSON.parse(recorder.files.get(path) ?? "{}"), { title: post.title, values: post.values })
  }
})
