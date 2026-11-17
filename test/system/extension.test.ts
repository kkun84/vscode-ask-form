import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { Effect, Fiber, Schedule } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { connect, runScoped, type Connection } from "../support/server.ts"
import { cancellation, createVscode, fakeContext, loadBundle, type FakePanel, type Recorder } from "../support/vscode-stub.ts"

const nodeBundle = fileURLToPath(new URL("../../dist/node/extension.cjs", import.meta.url))
const webBundle = fileURLToPath(new URL("../../dist/web/extension.js", import.meta.url))
const webTool = "forms_ask_form"

const readManifest = async <T>(): Promise<T> => JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as T

const formKey = eventForm.key

const until = (check: () => boolean) =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet"))).pipe(
    Effect.retry({ times: 400, schedule: Schedule.spaced("5 millis") }),
    Effect.orDie
  )

const start = async () => {
  const { vscode, recorder } = createVscode()
  const { context, dispose } = fakeContext()
  await loadBundle(nodeBundle, vscode, "node").activate(context)
  const provider = recorder.providers.get("ask-form.mcp")
  assert.ok(provider)
  return { recorder, provider, dispose }
}

const desktop = Effect.acquireRelease(
  Effect.promise(async () => {
    const { recorder, provider, dispose } = await start()
    const [definition] = provider.provideMcpServerDefinitions()
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

const submitRecommended = (panel: FakePanel | undefined): void =>
  panel?.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "form_answer", arguments: { formKey, action: "submit", values: initialValues(eventForm.spec) } }
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

describe("SPEC-EXT-006 MCPを使わない環境", () => {
  it("SPEC-EXT-006 設定でMCPを切るか、組織がMCPを制限するとMCPサーバーを提供せず、変更を通知する", async () => {
    const { recorder, provider, dispose } = await start()
    let notified = 0
    ;(
      provider as unknown as { readonly onDidChangeMcpServerDefinitions: (listener: () => void) => unknown }
    ).onDidChangeMcpServerDefinitions(() => notified++)
    assert.equal(provider.provideMcpServerDefinitions().length, 1)
    recorder.changeSetting("askForm.mcp.enabled", false)
    assert.equal(provider.provideMcpServerDefinitions().length, 0)
    recorder.changeSetting("askForm.mcp.enabled", true)
    assert.equal(provider.provideMcpServerDefinitions().length, 1)
    recorder.changeSetting("chat.mcp.access", "registry")
    assert.equal(provider.provideMcpServerDefinitions().length, 0)
    recorder.changeSetting("chat.mcp.access", "all")
    recorder.changeSetting("unrelated.setting", 1)
    assert.equal(notified, 4)
    await dispose()
  })

  it("SPEC-EXT-006 デスクトップ版でもツールを登録し、パネルに表示して回答を返す", async () => {
    const { recorder, dispose } = await start()
    const tool = recorder.tools.get(webTool)
    assert.ok(tool)
    const pending = tool.invoke({ input: eventSpec }, cancellation().token)
    const panel = recorder.panels[0]
    assert.ok(panel)
    submitRecommended(panel)
    assert.match(resultText(await pending), /"status":"submitted"/)
    await dispose()
  })

  it("SPEC-EXT-006 ツールはweb版と、MCPを切った環境、組織がMCPを制限した環境で有効になる", async () => {
    const manifest = await readManifest<{
      readonly contributes: {
        readonly languageModelTools: ReadonlyArray<{ readonly name: string; readonly when?: string }>
        readonly configuration: { readonly properties: Record<string, { readonly type: string; readonly default: unknown }> }
      }
    }>()
    const declared = manifest.contributes.languageModelTools.find((item) => item.name === webTool)
    assert.equal(declared?.when, "isWeb || !config.askForm.mcp.enabled || config.chat.mcp.access != 'all'")
    const setting = manifest.contributes.configuration.properties["askForm.mcp.enabled"]
    assert.deepEqual([setting?.type, setting?.default], ["boolean", true])
  })
})

const waitThenCancel = (recorder: Recorder, connection: Connection) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(connection.call("ask_form", eventSpec))
    yield* until(() => visible(recorder))
    yield* connection.call("form_answer", { formKey, action: "chat" })
    yield* Fiber.join(fiber)
  })

describe("SPEC-EXT-002 待機の表示", () => {
  it("SPEC-EXT-002 回答を待つ間だけステータスバーに表示する", () =>
    runScoped(
      Effect.gen(function* () {
        const { recorder, connection } = yield* desktopConnection
        assert.equal(visible(recorder), false)
        assert.equal(recorder.status[0]?.text.includes("Copilotが回答を待っています"), true)
        assert.equal(recorder.status[0]?.command, "workbench.action.chat.open")
        yield* waitThenCancel(recorder, connection)
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
    params: { name: "form_answer", arguments: { formKey, action: "submit", values: before } }
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
  assert.deepEqual(JSON.parse(recorder.files.get(draft.attachFiles[0]?.path ?? "") ?? "null"), {
    title: eventSpec.title,
    values: after,
    held: []
  })
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

  it("SPEC-EXT-004 回答せずにパネルを閉じると、キャンセルと同じ結果を返す", async () => {
    const opened = web()
    const result = opened.tool.invoke({ input: eventSpec }, cancellation().token)
    opened.recorder.panels.at(-1)?.dispose()
    assert.match(resultText(await result), /"status":"answer_in_chat"/)
    assert.equal(visible(opened.recorder), false)
  })

  it("SPEC-EXT-004 ツール名は予約された接頭辞を使わない", async () => {
    const manifest = await readManifest<{
      readonly contributes: { readonly languageModelTools: ReadonlyArray<{ readonly name: string }> }
    }>()
    for (const tool of manifest.contributes.languageModelTools) {
      assert.match(tool.name, /^[\w-]+$/)
      assert.doesNotMatch(tool.name, /^(?:vscode_|copilot_)/)
    }
  })
})

const askOnWeb = () => {
  const { recorder, tool } = web()
  const pending = tool.invoke({ input: eventSpec }, cancellation().token)
  return { recorder, pending, panel: recorder.panels[0] }
}

const expectClosed = (recorder: Recorder, panel: FakePanel | undefined, commands: Recorder["commands"] = []): void => {
  assert.equal(panel?.state.disposed, true)
  assert.deepEqual(recorder.commands, commands)
  assert.equal(visible(recorder), false)
}

describe("SPEC-EXT-004 回答後のパネル", () => {
  it("SPEC-EXT-004 キャンセルを押すとパネルを閉じ、チャットを開く", async () => {
    const { recorder, pending, panel } = askOnWeb()
    panel?.receive({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "form_answer", arguments: { formKey, action: "chat" } } })
    assert.match(resultText(await pending), /"status":"answer_in_chat"/)
    expectClosed(recorder, panel, [{ command: "workbench.action.chat.open", args: [] }])
  })

  it("SPEC-EXT-004 送信したパネルは閉じず、要約を残す", async () => {
    const { recorder, pending, panel } = askOnWeb()
    submitRecommended(panel)
    await pending
    assert.equal(panel?.state.disposed, false)
    assert.deepEqual(recorder.commands, [])
  })

  it("SPEC-EXT-002 パネルで待つ間は、待機の表示を押すと先に待ち始めたフォームのパネルを前面に出す", async () => {
    const { recorder, tool } = web()
    const first = tool.invoke({ input: eventSpec }, cancellation().token)
    const second = tool.invoke({ input: { ...eventSpec, title: "2つ目" } }, cancellation().token)
    const command = recorder.status.find((item) => item.visible)?.command
    assert.ok(command)
    recorder.run(command)
    assert.deepEqual(
      recorder.panels.map((panel) => panel.state.revealed),
      [1, 0]
    )
    recorder.panels[0]?.dispose()
    await first
    recorder.run(command)
    assert.deepEqual(
      recorder.panels.map((panel) => panel.state.revealed),
      [1, 1]
    )
    recorder.panels[1]?.dispose()
    await second
    assert.deepEqual(recorder.commands, [])
  })
})

describe("SPEC-EXT-007 自動で応じる設定", () => {
  it("SPEC-EXT-007 chat.autoReplyが有効な間、MCPのask_formは待たずにunavailableを返す", () =>
    runScoped(
      Effect.gen(function* () {
        const { recorder, connection } = yield* desktopConnection
        recorder.changeSetting("chat.autoReply", true)
        const result = yield* connection.call("ask_form", eventSpec)
        assert.equal((result.structuredContent as Record<string, unknown>)["status"], "unavailable")
        assert.equal(visible(recorder), false)
        recorder.changeSetting("chat.autoReply", false)
        yield* waitThenCancel(recorder, connection)
      })
    ))

  it("SPEC-EXT-007 待っている間にchat.autoReplyが有効になったら、MCPのask_formは待つのをやめてunavailableを返す", () =>
    runScoped(
      Effect.gen(function* () {
        const { recorder, connection } = yield* desktopConnection
        const fiber = yield* Effect.forkChild(connection.call("ask_form", eventSpec))
        yield* until(() => visible(recorder))
        recorder.changeSetting("chat.autoReply", false)
        recorder.changeSetting("unrelated.setting", 1)
        assert.equal(fiber.pollUnsafe(), undefined)
        recorder.changeSetting("chat.autoReply", true)
        const result = yield* Fiber.join(fiber)
        assert.equal((result.structuredContent as Record<string, unknown>)["status"], "unavailable")
        yield* until(() => !visible(recorder))
      })
    ))

  it("SPEC-EXT-007 待っている間にchat.autoReplyが有効になったら、拡張機能のツールはパネルを閉じてunavailableを返す", async () => {
    const { recorder, pending, panel } = askOnWeb()
    recorder.changeSetting("chat.autoReply", true)
    assert.match(resultText(await pending), /"status":"unavailable"/)
    expectClosed(recorder, panel)
  })

  it("SPEC-EXT-007 chat.autoReplyが有効な間、拡張機能のツールはパネルを開かずにunavailableを返す", async () => {
    const { recorder, tool } = web()
    recorder.changeSetting("chat.autoReply", true)
    const text = resultText(await tool.invoke({ input: eventSpec }, cancellation().token))
    assert.match(text, /"status":"unavailable"/)
    assert.match(text, /Do not ask these questions again/)
    assert.equal(recorder.panels.length, 0)
    assert.equal(visible(recorder), false)
    await assert.rejects(tool.invoke({ input: { title: "", fields: [] } }, cancellation().token))
  })
})

describe("SPEC-EXT-005 起動とサイズ", () => {
  it("SPEC-EXT-005 起動完了後に読み込まれ、読み込みと起動処理が予算内に終わる", async () => {
    const manifest = await readManifest<{
      readonly activationEvents: ReadonlyArray<string>
    }>()
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
