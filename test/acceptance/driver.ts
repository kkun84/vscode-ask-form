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

const describe = (error: unknown): string => {
  const chat = vscode.extensions.getExtension("github.copilot-chat")
  const state = chat === undefined ? "missing" : `active=${String(chat.isActive)}`
  return `${error instanceof Error ? error.message : String(error)} copilot=${state}`
}

const addGroup = async (group: Readonly<Record<string, unknown>>, attempt = 1): Promise<void> => {
  try {
    await vscode.commands.executeCommand("lm.addLanguageModelsProviderGroup", group)
  } catch (error) {
    log(`attempt ${attempt}: ${describe(error)}`)
    if (attempt >= 120) {
      throw error
    }
    await sleep(500)
    await addGroup(group, attempt + 1)
  }
}

const drive = async (context: vscode.ExtensionContext, url: string, query: string): Promise<void> => {
  const copilot = vscode.extensions.all
    .filter((item) => /copilot/i.test(item.id))
    .map((item) => `${item.id}@${String(item.packageJSON?.version)} active=${String(item.isActive)}`)
  log(`copilot extensions: ${copilot.join(", ") || "none"}`)
  await addGroup({
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
    throw new Error("the fake model is unavailable")
  }
  const draft = process.env["ASK_FORM_E2E_DRAFT"] === "1"
  let scenario = 0
  const openChat = async (): Promise<void> => {
    scenario++
    await vscode.commands.executeCommand("workbench.action.chat.newChat")
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: draft ? "" : scenario === 1 ? query : `${query} Scenario ${scenario}.`,
      isPartialQuery: draft,
      mode: "agent",
      modelSelector: { vendor: model.vendor, id: model.id }
    })
    log(`chat ${scenario} opened`)
  }
  context.subscriptions.push(vscode.commands.registerCommand("ask-form-e2e.newChat", openChat))
  await openChat()
}

export const activate = (context: vscode.ExtensionContext): void => {
  const url = process.env["ASK_FORM_E2E_LLM_URL"]
  const query = process.env["ASK_FORM_E2E_QUERY"]
  if (url === undefined || query === undefined) {
    return
  }
  drive(context, url, query).catch((error: unknown) =>
    log(`error ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  )
}

export const deactivate = (): void => undefined
