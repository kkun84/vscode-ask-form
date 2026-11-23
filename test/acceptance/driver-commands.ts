import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"

const toolName = "ask_user_form"

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

export const registerCommands = (context: vscode.ExtensionContext, emit: (line: string) => void): void => {
  let count = 0
  let source: vscode.CancellationTokenSource | undefined
  context.subscriptions.push(
    vscode.commands.registerCommand("ask-user-form-e2e.state", () => {
      const target = vscode.extensions.getExtension("kkun84.ask-user-form")
      const tool = vscode.lm.tools.some((item) => item.name === toolName)
      emit(`state active=${String(target?.isActive === true)} tool=${String(tool)}`)
    }),
    vscode.commands.registerCommand("ask-user-form-e2e.invoke", async () => {
      count++
      const index = count
      const current = new vscode.CancellationTokenSource()
      source = current
      emit(`invoked ${index}`)
      await registered()
      const settled = await vscode.lm
        .invokeTool(
          toolName,
          { input: { ...eventSpec, title: `${eventSpec.title} ${index}` }, toolInvocationToken: undefined },
          current.token
        )
        .then(textOf, (error: unknown) => `error ${error instanceof Error ? error.message : String(error)}`)
      emit(`result ${index} ${JSON.stringify(settled)}`)
    }),
    vscode.commands.registerCommand("ask-user-form-e2e.cancel", () => source?.cancel())
  )
  emit("commands ready")
}
