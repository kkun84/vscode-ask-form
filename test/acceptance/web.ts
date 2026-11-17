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
  await eventually(() => !formTab(), "the panel closes after the answer")
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
  await eventually(
    () => !vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === `${eventSpec.title} 2`)),
    "the panel closes after the cancellation"
  )
})

const hiddenTitle = `${eventSpec.title} 3`

const tabOf = (title: string): boolean => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label === title))

const frontTab = (title: string): boolean => vscode.window.tabGroups.all.some((group) => group.activeTab?.label === title)

test("REQ-WAIT-001 web版でフォームが別のタブに隠れても、待機の表示から前面に出せ、キャンセルを押すとパネルが閉じる", async () => {
  const pending = vscode.lm.invokeTool(toolName, { input: { ...eventSpec, title: hiddenTitle }, toolInvocationToken: undefined })
  await eventually(() => frontTab(hiddenTitle), "the third form opens in a panel")
  await vscode.commands.executeCommand("workbench.action.files.newUntitledFile")
  await eventually(() => tabOf(hiddenTitle) && !frontTab(hiddenTitle), "another editor covers the form")
  console.log("ask-form: form covered")
  await eventually(() => frontTab(hiddenTitle), "the waiting status brings the form to the front", 60_000)
  console.log("ask-form: form revealed")
  const result = textOf(await pending)
  check(result.includes('"status":"answer_in_chat"'), `Cancel settles the call: ${result}`)
  await eventually(() => !tabOf(hiddenTitle), "the panel closes after Cancel")
})

export { run }
