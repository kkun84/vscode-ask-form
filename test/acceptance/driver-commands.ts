import * as vscode from "vscode"
import { eventSpec } from "../fixtures/event.ts"
import { kindsSpec, unrecommendedSpec } from "../fixtures/kinds.ts"

const toolName = "ask_user_form"

const themes = { light: "Default Light Modern", dark: "Default Dark Modern", contrast: "Default High Contrast" } as const

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
  const invoke = async (spec: typeof eventSpec | typeof kindsSpec | typeof unrecommendedSpec): Promise<void> => {
    count++
    const index = count
    const current = new vscode.CancellationTokenSource()
    source = current
    emit(`invoked ${index}`)
    await registered()
    const settled = await vscode.lm
      .invokeTool(toolName, { input: { ...spec, title: `${spec.title} ${index}` }, toolInvocationToken: undefined }, current.token)
      .then(textOf, (error: unknown) => `error ${error instanceof Error ? error.message : String(error)}`)
    emit(`result ${index} ${JSON.stringify(settled)}`)
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("ask-user-form-e2e.state", () => {
      const target = vscode.extensions.getExtension("kkun84.ask-user-form")
      const tool = vscode.lm.tools.some((item) => item.name === toolName)
      emit(`state active=${String(target?.isActive === true)} tool=${String(tool)}`)
    }),
    vscode.commands.registerCommand("ask-user-form-e2e.invoke", () => invoke(eventSpec)),
    vscode.commands.registerCommand("ask-user-form-e2e.invokeKinds", () => invoke(kindsSpec)),
    vscode.commands.registerCommand("ask-user-form-e2e.invokeUnrecommended", () => invoke(unrecommendedSpec)),
    vscode.commands.registerCommand("ask-user-form-e2e.cancel", () => source?.cancel()),
    ...Object.entries(themes).map(([name, theme]) =>
      vscode.commands.registerCommand(`ask-user-form-e2e.theme.${name}`, async () => {
        await vscode.workspace.getConfiguration("workbench").update("colorTheme", theme, vscode.ConfigurationTarget.Global)
        emit(`theme ${theme}`)
      })
    )
  )
  emit("commands ready")
}
