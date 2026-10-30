import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { Effect, Fiber, Schedule } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { connect, runScoped } from "../support/server.ts"
import { cancellation, createVscode, fakeContext, loadBundle, type Recorder } from "../support/vscode-stub.ts"

const nodeBundle = fileURLToPath(new URL("../../dist/node/extension.cjs", import.meta.url))
const webBundle = fileURLToPath(new URL("../../dist/web/extension.js", import.meta.url))
const webTool = "forms_ask_form"

const formKey = eventForm.key

const until = (check: () => boolean) =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet"))).pipe(
    Effect.retry({ times: 400, schedule: Schedule.spaced("5 millis") }),
    Effect.orDie
  )

const desktop = Effect.acquireRelease(
  Effect.promise(async () => {
    const { vscode, recorder } = createVscode()
    const { context, dispose } = fakeContext()
    await loadBundle(nodeBundle, vscode, "node").activate(context)
    const [definition] = recorder.providers.get("ask-form.mcp")?.provideMcpServerDefinitions() ?? []
    if (definition === undefined) {
      throw new Error("MCP server definition is missing")
    }
    return { recorder, definition, dispose }
  }),
  ({ dispose }) => Effect.promise(dispose)
)

const desktopConnection = Effect.gen(function* () {
  const { recorder, definition } = yield* desktop
  const token = (definition.headers["authorization"] ?? "").replace("Bearer ", "")
  const connection = yield* connect(definition.uri.toString(), token)
  return { recorder, connection }
})

const visible = (recorder: Recorder) => recorder.status.some((item) => item.visible)

describe("SPEC-EXT-001 MCPサーバーの登録", () => {
  it("SPEC-EXT-001 起動するとトークンつきのHTTPのMCPサーバーを登録し、ask_formを呼べる", () =>
    runScoped(
      Effect.gen(function* () {
        const { definition } = yield* desktop
        assert.match(definition.uri.toString(), /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
        assert.match(definition.headers["authorization"] ?? "", /^Bearer [0-9a-f-]{36}$/)
        const { connection } = yield* desktopConnection
        const tool = yield* connection.tool("ask_form")
        assert.equal(tool.annotations?.readOnlyHint, true)
      })
    ))
})

describe("SPEC-EXT-002 待機の表示", () => {
  it("SPEC-EXT-002 回答を待つ間だけステータスバーに表示する", () =>
    runScoped(
      Effect.gen(function* () {
        const { recorder, connection } = yield* desktopConnection
        assert.equal(visible(recorder), false)
        assert.equal(recorder.status[0]?.text.includes("Copilotが回答を待っています"), true)
        const fiber = yield* Effect.forkChild(connection.call("ask_form", eventSpec))
        yield* until(() => visible(recorder))
        yield* connection.call("form_answer", { formKey, action: "delegate" })
        yield* Fiber.join(fiber)
        yield* until(() => !visible(recorder))
      })
    ))
})

const web = () => {
  const { vscode, recorder } = createVscode()
  const { context } = fakeContext()
  loadBundle(webBundle, vscode, "web").activate(context)
  const tool = recorder.tools.get(webTool)
  if (tool === undefined) {
    throw new Error("web tool is missing")
  }
  return { recorder, tool }
}

const resultText = (result: unknown): string =>
  (result as { readonly content: ReadonlyArray<{ readonly value: string }> }).content[0]?.value ?? ""

it("SPEC-EXT-003 web版ではJSONを保存して添付し、利用者が送信する下書きとして入力欄に入れる", async () => {
  const { recorder, tool } = web()
  const source = cancellation()
  const pending = tool.invoke({ input: eventSpec }, source.token)
  const panel = recorder.panels[0]
  assert.ok(panel)
  const before = initialValues(eventForm.spec)
  panel.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "form_answer", arguments: { formKey, action: "delegate" } }
  })
  await pending
  const after = { ...before, price: 2500 }
  panel.receive({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "form_resend", arguments: { spec: eventSpec, before, after } }
  })
  await Effect.runPromise(until(() => recorder.commands.length > 0))
  assert.equal(recorder.commands.length, 1)
  const command = recorder.commands[0]
  assert.equal(command?.command, "workbench.action.chat.open")
  const draft = command?.args[0] as { readonly isPartialQuery: boolean; readonly attachFiles: ReadonlyArray<{ readonly path: string }> }
  assert.equal(draft.isPartialQuery, true)
  assert.deepEqual(JSON.parse(recorder.files.get(draft.attachFiles[0]?.path ?? "") ?? "null"), { title: eventSpec.title, values: after })
})

describe("SPEC-EXT-004 web版", () => {
  it("SPEC-EXT-004 ツールが呼ばれるとパネルにフォームを表示し、回答を結果として返す", async () => {
    const { recorder, tool } = web()
    const pending = tool.invoke({ input: eventSpec }, cancellation().token)
    const [panel] = recorder.panels
    assert.equal(panel?.title, eventSpec.title)
    assert.match(panel?.html() ?? "", /Content-Security-Policy/)
    assert.equal(visible(recorder), true)
    panel?.receive({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} })
    assert.equal(
      panel?.sent.some((message) => message["method"] === "ui/notifications/tool-input"),
      true
    )
    const values = { ...initialValues(eventForm.spec), attendees: 150 }
    panel?.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "form_answer", arguments: { formKey, action: "submit", values } }
    })
    const text = resultText(await pending)
    assert.match(text, /"status":"submitted"/)
    assert.match(text, /"changedByUser":\["attendees"\]/)
    assert.equal(visible(recorder), false)
  })

  it("SPEC-EXT-004 読み込み中の取り消しも結果を返し、パネルの初期化後に再通知する", async () => {
    const { recorder, tool } = web()
    const { token, cancel } = cancellation()
    const pending = tool.invoke({ input: eventSpec }, token)
    cancel()
    assert.match(resultText(await pending), /"status":"answer_in_chat"/)
    assert.equal(
      recorder.panels[0]?.sent.some((message) => message["method"] === "ui/notifications/tool-cancelled"),
      true
    )
    const panel = recorder.panels[0]
    assert.ok(panel)
    panel.sent.length = 0
    panel.receive({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} })
    assert.equal(panel.sent.at(-1)?.["method"], "ui/notifications/tool-cancelled")
    assert.equal(visible(recorder), false)
  })

  it("SPEC-EXT-004 ツールはweb版でだけ有効になる", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      readonly contributes: { readonly languageModelTools: ReadonlyArray<{ readonly name: string; readonly when?: string }> }
    }
    const declared = manifest.contributes.languageModelTools.find((item) => item.name === webTool)
    assert.equal(declared?.when, "isWeb")
    for (const tool of manifest.contributes.languageModelTools) {
      assert.match(tool.name, /^[\w-]+$/)
      assert.doesNotMatch(tool.name, /^(?:vscode_|copilot_)/)
    }
  })
})

describe("SPEC-EXT-005 起動とサイズ", () => {
  it("SPEC-EXT-005 起動完了後に読み込まれ、読み込みと起動処理が予算内に終わる", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
      readonly activationEvents: ReadonlyArray<string>
    }
    assert.equal(manifest.activationEvents.includes("*"), false)
    assert.equal(manifest.activationEvents.includes("onStartupFinished"), true)
    const budgets = JSON.parse(await readFile(new URL("../../budgets.json", import.meta.url), "utf8")) as { readonly activationMs: number }
    const { vscode } = createVscode()
    const { context, dispose } = fakeContext()
    const started = performance.now()
    await loadBundle(nodeBundle, vscode, "node").activate(context)
    const elapsed = performance.now() - started
    await dispose()
    assert.ok(elapsed < budgets.activationMs, `${elapsed.toFixed(0)}ms`)
  })
})
