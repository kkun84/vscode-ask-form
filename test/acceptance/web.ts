import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"
import { check, eventually, extension, run, test } from "./harness.ts"

const toolName = "forms_ask_form"

const formTab = (): boolean =>
  vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === eventSpec.title)
  )

const textOf = (result: vscode.LanguageModelToolResult): string =>
  result.content.map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : "")).join("")

test("REQ-WEB-001 web版ではフォームを横のパネルに表示し、そこで回答するとツールの結果になる", async () => {
  await eventually(() => vscode.lm.tools.some((tool) => tool.name === toolName), "the form tool is registered")
  const pending = vscode.lm.invokeTool(toolName, { input: eventSpec, toolInvocationToken: undefined })
  await eventually(formTab, "the form opens in a panel")
  check(extension().isActive, "the extension is active")
  const result = textOf(await pending)
  check(result.includes('"status":"submitted"'), `the answer becomes the tool result: ${result}`)
  check(result.includes('"changedByUser":["attendees"]'), `the tool result marks the changed field: ${result}`)
})

test("REQ-WEB-001 web版でツールの呼び出しを取り消すと、待機が終わる", async () => {
  const source = new vscode.CancellationTokenSource()
  const pending = vscode.lm.invokeTool(
    toolName,
    { input: { ...eventSpec, title: `${eventSpec.title} 2` }, toolInvocationToken: undefined },
    source.token
  )
  await eventually(
    () => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === `${eventSpec.title} 2`)),
    "the second form opens in a panel"
  )
  source.cancel()
  const settled = await pending.then(textOf, (error: unknown) => (error instanceof Error ? error.message : String(error)))
  check(settled.includes('"status":"answer_in_chat"') || settled.includes("Canceled"), `cancelling settles the call: ${settled}`)
})

export { run }
