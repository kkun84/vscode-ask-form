import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"

const toolName = "forms_ask_form"

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const textOf = (result: vscode.LanguageModelToolResult): string =>
  result.content.map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : "")).join("")

const registered = async (): Promise<void> => {
  for (let i = 0; i < 150 && !vscode.lm.tools.some((tool) => tool.name === toolName); i++) {
    await sleep(100)
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  let count = 0
  let source: vscode.CancellationTokenSource | undefined
  context.subscriptions.push(
    vscode.commands.registerCommand("ask-form-e2e.invoke", async () => {
      count++
      const index = count
      const current = new vscode.CancellationTokenSource()
      source = current
      console.log(`ask-form-e2e invoked ${index}`)
      await registered()
      const settled = await vscode.lm
        .invokeTool(
          toolName,
          { input: { ...eventSpec, title: `${eventSpec.title} ${index}` }, toolInvocationToken: undefined },
          current.token
        )
        .then(textOf, (error: unknown) => `error ${error instanceof Error ? error.message : String(error)}`)
      console.log(`ask-form-e2e result ${index} ${settled}`)
    }),
    vscode.commands.registerCommand("ask-form-e2e.cancel", () => source?.cancel())
  )
}

export const deactivate = (): void => undefined
