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

const registerModel = async (url: string): Promise<vscode.LanguageModelChat> => {
  const copilot = vscode.extensions.all
    .filter((item) => /copilot/i.test(item.id))
    .map((item) => `${item.id}@${String(item.packageJSON?.version)} active=${String(item.isActive)}`)
  log(`copilot extensions: ${copilot.join(", ") || "none"}`)
  await addGroup({
    name: "Stub",
    vendor: "customendpoint",
    apiKey: "stub-key",
    apiType: "chat-completions",
    models: [
      {
        id: "stub-model",
        name: "Stub Model",
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
    throw new Error("the stub model is unavailable")
  }
  return model
}

const toggleAutoReply = async (): Promise<void> => {
  const chat = vscode.workspace.getConfiguration("chat")
  await chat.update("autoReply", chat.get<boolean>("autoReply", false) !== true, vscode.ConfigurationTarget.Global)
  log(`chat.autoReply ${String(vscode.workspace.getConfiguration("chat").get("autoReply"))}`)
}

const applySettings = async (): Promise<void> => {
  const settings = JSON.parse(process.env["ASK_FORM_E2E_SETTINGS"] ?? "{}") as Readonly<Record<string, unknown>>
  for (const [key, value] of Object.entries(settings)) {
    await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global)
  }
}

const reportState = (): void => {
  const target = vscode.extensions.getExtension("kkun84.ask-form")
  const tool = vscode.lm.tools.some((item) => item.name === "forms_ask_form")
  log(`state active=${String(target?.isActive === true)} tool=${String(tool)}`)
}

const drive = async (context: vscode.ExtensionContext, url: string, query: string): Promise<void> => {
  await applySettings()
  const model = await registerModel(url)
  const draft = process.env["ASK_FORM_E2E_DRAFT"] === "1"
  let scenario = 0
  const openChat = async (): Promise<void> => {
    scenario++
    if (process.env["ASK_FORM_E2E_SETTINGS"] === undefined) {
      await vscode.commands.executeCommand("workbench.action.chat.newChat")
    } else {
      await vscode.commands.executeCommand("workbench.action.chat.openNewChatSessionInPlace.local", "sidebar")
    }
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: draft ? "" : scenario === 1 ? query : `${query} Scenario ${scenario}.`,
      isPartialQuery: draft,
      mode: "agent",
      modelSelector: { vendor: model.vendor, id: model.id }
    })
    log(`chat ${scenario} opened`)
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("ask-form-e2e.newChat", openChat),
    vscode.commands.registerCommand("ask-form-e2e.autoReply", toggleAutoReply)
  )
  log("ready")
  if (process.env["ASK_FORM_E2E_AUTOSTART"] !== "0") {
    await openChat()
  }
}

const harnesses = ["claude", "codex"] as const

const fail = (error: unknown): void => log(`error ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)

export const activate = (context: vscode.ExtensionContext): void => {
  for (const harness of harnesses) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`ask-form-e2e.${harness}`, async () => {
        await vscode.commands.executeCommand("workbench.action.chat.agentHost.downloadAgentSdk", harness)
        await vscode.commands.executeCommand(`workbench.action.chat.openNewChatSessionInPlace.agent-host-${harness}`, "sidebar")
      })
    )
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("ask-form-e2e.copilot", () =>
      vscode.commands.executeCommand("workbench.action.chat.openNewChatSessionInPlace.agent-host-copilotcli", "sidebar")
    ),
    vscode.commands.registerCommand("ask-form-e2e.agentsWindow", () => vscode.commands.executeCommand("workbench.action.openAgentsWindow")),
    vscode.commands.registerCommand("ask-form-e2e.state", reportState)
  )
  if (process.env["ASK_FORM_E2E_TOOL_SEARCH"] !== undefined) {
    context.subscriptions.push(
      vscode.lm.registerTool<{ query: string; candidateTools?: ReadonlyArray<{ name: string; description: string }> }>("e2e_tool_search", {
        invoke: (options) => {
          const candidates = options.input.candidateTools
          log(
            `toolSearch query=${options.input.query} candidates(${String(candidates?.length)})=${(candidates ?? []).map((c) => c.name).join(",")}`
          )
          const matched = (candidates ?? []).filter((c) => /ask/i.test(c.name)).map((c) => c.name)
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(matched))])
        }
      })
    )
  }
  const byok = process.env["ASK_FORM_E2E_BYOK_URL"]
  if (byok !== undefined) {
    registerModel(byok).catch(fail)
  }
  const url = process.env["ASK_FORM_E2E_LLM_URL"]
  const query = process.env["ASK_FORM_E2E_QUERY"]
  if (url === undefined || query === undefined) {
    return
  }
  drive(context, url, query).catch(fail)
}

export const deactivate = (): void => undefined
