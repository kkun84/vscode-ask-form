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
    const [definition] = recorder.providers.get("copilot-forms.mcp")?.provideMcpServerDefinitions() ?? []
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

describe("SPEC-EXT-003 投稿", () => {
  it("SPEC-EXT-003 送り直しの文章を、値のJSONを添付してチャットに送信する", () =>
    runScoped(
      Effect.gen(function* () {
        const { recorder, connection } = yield* desktopConnection
        const before = initialValues(eventForm.spec)
        const result = yield* connection.call("form_resend", { spec: eventSpec, before, after: { ...before, price: 2500 }, locale: "ja" })
        assert.equal(result.isError, false)
        const [sent] = recorder.commands
        assert.equal(sent?.command, "workbench.action.chat.open")
        const options = sent?.args[0] as {
          readonly query: string
          readonly isPartialQuery: boolean
          readonly attachFiles: ReadonlyArray<{ readonly path: string }>
        }
        assert.equal(options.query, "「交流会の条件」で参加費を¥2,500に変えたので、反映して続けてください。")
        assert.equal(options.isPartialQuery, false)
        const attached = recorder.files.get(options.attachFiles[0]?.path ?? "")
        assert.deepEqual(JSON.parse(attached ?? "{}"), { title: eventSpec.title, values: { ...before, price: 2500 } })
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

  it("SPEC-EXT-004 呼び出しが取り消されるとチャットで答える結果を返す", async () => {
    const { recorder, tool } = web()
    const { token, cancel } = cancellation()
    const pending = tool.invoke({ input: eventSpec }, token)
    cancel()
    assert.match(resultText(await pending), /"status":"answer_in_chat"/)
    assert.equal(
      recorder.panels[0]?.sent.some((message) => message["method"] === "ui/notifications/tool-cancelled"),
      true
    )
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
