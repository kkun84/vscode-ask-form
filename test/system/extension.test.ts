import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "vitest"
import { initialValues } from "../../src/core/form.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { cancellation, createVscode, fakeContext, loadBundle, type FakePanel, type Recorder } from "../support/vscode-stub.ts"

const nodeBundle = fileURLToPath(new URL("../../dist/node/extension.cjs", import.meta.url))
const toolName = "ask_user_form"

const readManifest = async <T>(): Promise<T> => JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as T

const formKey = eventForm.key

const start = async () => {
  const { vscode, recorder } = createVscode()
  const { context, dispose } = fakeContext()
  await loadBundle(nodeBundle, vscode).activate(context)
  return { recorder, dispose }
}

const submitRecommended = (panel: FakePanel | undefined): void =>
  panel?.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "form_answer", arguments: { formKey, action: "submit", values: initialValues(eventForm.spec) } }
  })

const visible = (recorder: Recorder) => recorder.status.some((item) => item.visible)

const expectClosed = (recorder: Recorder, panel: FakePanel | undefined, commands: Recorder["commands"] = []): void => {
  assert.equal(panel?.state.disposed, true)
  assert.deepEqual(panel?.sent, [])
  assert.deepEqual(recorder.commands, commands)
  assert.equal(visible(recorder), false)
  assert.equal(recorder.configListeners(), 0)
}

describe("SPEC-TOOL-001 質問のツール", () => {
  it("SPEC-TOOL-001 ツールを登録し、パネルに表示して回答を返す", async () => {
    const { recorder, dispose } = await start()
    const tool = recorder.tools.get(toolName)
    assert.ok(tool)
    assert.deepEqual(recorder.providers.size, 0)
    const pending = tool.invoke({ input: eventSpec }, cancellation().token)
    const panel = recorder.panels[0]
    assert.ok(panel)
    submitRecommended(panel)
    assert.match(resultText(await pending), /"status":"submitted"/)
    await dispose()
  })

  it("SPEC-TOOL-001 ツールは常に有効で、組み込みの質問ツールより優先するよう説明し、MCPサーバーを提供しない", async () => {
    const manifest = await readManifest<{
      readonly contributes: Record<string, unknown> & {
        readonly languageModelTools: ReadonlyArray<{ readonly name: string; readonly when?: string; readonly modelDescription: string }>
        readonly configuration: { readonly properties: Record<string, unknown> }
      }
    }>()
    const declared = manifest.contributes.languageModelTools.find((item) => item.name === toolName)
    assert.equal(declared?.when, undefined)
    for (const builtIn of ["askQuestions", "ask_user", "AskUserQuestion", "request_user_input"]) {
      assert.ok(declared?.modelDescription.includes(builtIn), builtIn)
    }
    assert.equal("mcpServerDefinitionProviders" in manifest.contributes, false)
    assert.equal("askUserForm.mcp.enabled" in manifest.contributes.configuration.properties, false)
  })
})

it("SPEC-EXT-002 拡張機能を止めると、待機の表示のコマンドも片付ける", async () => {
  const { recorder, dispose } = await start()
  const command = recorder.status.map((item) => item.command).find((name) => name !== "workbench.action.chat.open")
  assert.ok(command)
  recorder.run(command)
  assert.deepEqual(recorder.commands, [])
  await dispose()
  recorder.run(command)
  assert.deepEqual(recorder.commands, [{ command, args: [] }])
})

describe("SPEC-EXT-002 待機の表示", () => {
  it("SPEC-EXT-002 回答を待つ間だけステータスバーに表示する", async () => {
    const { recorder, dispose } = await start()
    assert.equal(visible(recorder), false)
    assert.equal(recorder.status[0]?.text.includes("Copilotが回答を待っています"), true)
    const pending = recorder.tools.get(toolName)?.invoke({ input: eventSpec }, cancellation().token)
    assert.equal(visible(recorder), true)
    recorder.panels[0]?.dispose()
    await pending
    assert.equal(visible(recorder), false)
    await dispose()
  })
})

const loaded = () => {
  const { vscode, recorder } = createVscode()
  const { context } = fakeContext()
  loadBundle(nodeBundle, vscode).activate(context)
  const tool = recorder.tools.get(toolName)
  if (tool === undefined) {
    throw new Error("the tool is missing")
  }
  return { recorder, tool }
}

const resultText = (result: unknown): string =>
  (result as { readonly content: ReadonlyArray<{ readonly value: string }> }).content[0]?.value ?? ""

const askOnWeb = () => {
  const { recorder, tool } = loaded()
  const source = cancellation()
  const pending = tool.invoke({ input: eventSpec }, source.token)
  return { recorder, pending, panel: recorder.panels[0], source }
}

const expectSettled = async (asked: ReturnType<typeof askOnWeb>, status: string, commands: Recorder["commands"] = []): Promise<void> => {
  assert.equal(resultText(await asked.pending).includes(`"status":"${status}"`), true)
  expectClosed(asked.recorder, asked.panel, commands)
  assert.equal(asked.source.listeners(), 0)
}

describe("SPEC-EXT-004 パネルのフォーム", () => {
  it("SPEC-EXT-004 ツールが呼ばれるとパネルにフォームを表示し、回答を結果として返す", async () => {
    const { recorder, tool } = loaded()
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

  it("SPEC-EXT-004 チャットを停止すると、読み込み中でも結果を返してパネルを閉じ、チャットを開かない", async () => {
    const { recorder, tool } = loaded()
    const source = cancellation()
    const pending = tool.invoke({ input: eventSpec }, source.token)
    source.cancel()
    assert.match(resultText(await pending), /"status":"answer_in_chat"/)
    expectClosed(recorder, recorder.panels[0])
    assert.equal(source.listeners(), 0)
  })

  it("SPEC-EXT-004 回答せずにパネルを閉じると、キャンセルと同じ結果を返し、購読を残さない", async () => {
    const asked = askOnWeb()
    asked.panel?.dispose()
    await expectSettled(asked, "answer_in_chat")
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

describe("SPEC-EXT-004 回答後のパネル", () => {
  const cases = [
    {
      name: "キャンセルを押すとパネルを閉じ、チャットを開く",
      action: "chat",
      status: "answer_in_chat",
      commands: [{ command: "workbench.action.chat.open", args: [] }]
    },
    { name: "送信するとパネルを閉じ、チャットにフォーカスを移さない", action: "submit", status: "submitted", commands: [] }
  ]
  for (const { name, action, status, commands } of cases) {
    it(`SPEC-EXT-004 ${name}`, async () => {
      const asked = askOnWeb()
      assert.equal(asked.source.listeners(), 1)
      const values = initialValues(eventForm.spec)
      asked.panel?.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "form_answer", arguments: { formKey, action, values } }
      })
      await expectSettled(asked, status, commands)
    })
  }

  it("SPEC-EXT-004 チャットを開けない環境でも、キャンセルは結果を返してパネルを閉じ、例外を残さない", async () => {
    const rejections: Array<unknown> = []
    const record = (reason: unknown) => rejections.push(reason)
    process.on("unhandledRejection", record)
    const { recorder, pending, panel } = askOnWeb()
    recorder.settings.set("test.commandsFail", true)
    panel?.receive({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "form_answer", arguments: { formKey, action: "chat" } } })
    assert.match(resultText(await pending), /"status":"answer_in_chat"/)
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    process.off("unhandledRejection", record)
    assert.equal(panel?.state.disposed, true)
    assert.deepEqual(rejections, [])
  })

  it("SPEC-EXT-002 パネルで待つ間は、待機の表示を押すと先に待ち始めたフォームのパネルを前面に出す", async () => {
    const { recorder, tool } = loaded()
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

const settingsOf = (presets: unknown) => {
  const { recorder, tool } = loaded()
  if (presets !== undefined) {
    recorder.changeSetting("askUserForm.commentPresets", presets)
  }
  void tool.invoke({ input: eventSpec }, cancellation().token)
  const panel = recorder.panels[0]
  panel?.receive({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "form_settings", arguments: {} } })
  const reply = panel?.sent.find((message) => message["id"] === 7) as { readonly result: { readonly structuredContent: unknown } }
  panel?.dispose()
  return reply.result.structuredContent
}

describe("SPEC-TOOL-010 画面の設定", () => {
  it("SPEC-TOOL-010 利用者の設定したコメントの定型文を、文字列でない要素と空の文を捨てて返し、設定がなければnullを返す", () => {
    assert.deepEqual(settingsOf(undefined), { commentPresets: null })
    assert.deepEqual(settingsOf(["保留", 1, " ", " 任せる "]), { commentPresets: ["保留", "任せる"] })
  })
})

describe("SPEC-EXT-007 自動で応じる設定", () => {
  it("SPEC-EXT-007 待っている間にchat.autoReplyが有効になったら、拡張機能のツールはパネルを閉じてunavailableを返す", async () => {
    const asked = askOnWeb()
    let settled = false
    void asked.pending.then(() => (settled = true))
    asked.recorder.changeSetting("chat.autoReply", false)
    asked.recorder.changeSetting("unrelated.setting", 1)
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    assert.equal(settled, false)
    assert.equal(asked.panel?.state.disposed, false)
    asked.recorder.changeSetting("chat.autoReply", true)
    await expectSettled(asked, "unavailable")
  })

  it("SPEC-EXT-007 chat.autoReplyが有効な間、拡張機能のツールはパネルを開かずにunavailableを返す", async () => {
    const { recorder, tool } = loaded()
    recorder.changeSetting("chat.autoReply", true)
    const text = resultText(await tool.invoke({ input: eventSpec }, cancellation().token))
    assert.match(text, /"status":"unavailable"/)
    assert.match(text, /Do not ask these questions again in this turn.*tell the user which assumptions you made/)
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
    await loadBundle(nodeBundle, vscode).activate(context)
    const elapsed = performance.now() - started
    await dispose()
    assert.ok(elapsed < budgets.activationMs, `${elapsed.toFixed(0)}ms`)
  })
})
