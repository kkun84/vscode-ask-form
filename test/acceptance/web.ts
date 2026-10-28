import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"
import { check, eventually, extension, run, test } from "./harness.ts"

const toolName = "copilot_forms_ask_form"

const formTab = (): boolean =>
  vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === eventSpec.title)
  )

test("REQ-WEB-001 web版ではフォームのツールが使え、フォームを横のパネルに表示する", async () => {
  await eventually(() => vscode.lm.tools.some((tool) => tool.name === toolName), "the form tool is registered")
  const source = new vscode.CancellationTokenSource()
  const pending = vscode.lm.invokeTool(toolName, { input: eventSpec, toolInvocationToken: undefined }, source.token)
  await eventually(formTab, "the form opens in a panel")
  check(extension().isActive, "the extension is active")
  source.cancel()
  const result = await pending
  const text = result.content.map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : "")).join("")
  check(text.includes('"status":"answer_in_chat"'), `cancelling returns answer_in_chat: ${text}`)
})

export { run }
