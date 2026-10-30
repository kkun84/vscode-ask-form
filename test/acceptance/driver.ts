import { appendFileSync } from "node:fs"
import * as vscode from "vscode"

const log = (line: string): void => {
  const file = process.env["ASK_FORM_E2E_LOG"]
  if (file !== undefined) {
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  }
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const waitForModel = async (): Promise<vscode.LanguageModelChat | undefined> => {
  for (let i = 0; i < 300; i++) {
    const [model] = await vscode.lm.selectChatModels({ vendor: "customendpoint" })
    if (model !== undefined) {
      return model
    }
    await sleep(100)
  }
  return undefined
}

const drive = async (url: string, query: string): Promise<void> => {
  await vscode.commands.executeCommand("lm.addLanguageModelsProviderGroup", {
    name: "Fake",
    vendor: "customendpoint",
    apiKey: "fake-key",
    apiType: "chat-completions",
    models: [
      {
        id: "fake-model",
        name: "Fake Model",
        url,
        toolCalling: true,
        vision: false,
        streaming: false,
        maxInputTokens: 128_000,
        maxOutputTokens: 4096
      }
    ]
  })
  log("provider group added")
  const model = await waitForModel()
  log(`model ${model === undefined ? "missing" : `${model.vendor}/${model.id}`}`)
  if (model === undefined) {
    return
  }
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query,
    mode: "agent",
    modelSelector: { vendor: model.vendor, id: model.id }
  })
  log("chat opened")
}

export const activate = (): void => {
  const url = process.env["ASK_FORM_E2E_LLM_URL"]
  const query = process.env["ASK_FORM_E2E_QUERY"]
  if (url === undefined || query === undefined) {
    return
  }
  drive(url, query).catch((error: unknown) => log(`error ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`))
}

export const deactivate = (): void => undefined
