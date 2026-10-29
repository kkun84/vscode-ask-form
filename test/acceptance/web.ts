import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"
import { check, eventually, extension, run, test } from "./harness.ts"

const toolName = "forms_ask_form"

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
  const settled = await pending.then(
    (result) => result.content.map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : "")).join(""),
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  )
  check(settled.includes('"status":"answer_in_chat"') || settled.includes("Canceled"), `cancelling settles the call: ${settled}`)
})

export { run }
