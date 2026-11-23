import { join } from "node:path"

type Json = Readonly<Record<string, unknown>>

const capiModel = "gpt-5.5"

const capiToken = "stub-agent-host-token"

const model = {
  id: capiModel,
  name: "Stub Model",
  object: "model",
  version: capiModel,
  vendor: "OpenAI",
  model_picker_enabled: true,
  model_picker_category: "powerful",
  model_picker_price_category: "medium",
  is_chat_default: true,
  is_chat_fallback: true,
  preview: false,
  billing: { is_premium: false, multiplier: 0 },
  capabilities: {
    type: "chat",
    family: capiModel,
    tokenizer: "o200k_base",
    object: "model_capabilities",
    limits: { max_prompt_tokens: 272_000, max_output_tokens: 128_000, max_context_window_tokens: 400_000 },
    supports: { streaming: true, tool_calls: true, parallel_tool_calls: true, vision: false, structured_outputs: true }
  },
  supported_endpoints: ["/responses"]
}

const token = (origin: string): Json => ({
  token: "stub-copilot-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_in: 1800,
  sku: "individual_subscription_copilot",
  individual: true,
  isNoAuthUser: true,
  copilot_plan: "pro",
  organization_login_list: [],
  endpoints: { api: origin, proxy: origin }
})

const chatToken = (origin: string): string => Buffer.from(JSON.stringify(token(origin))).toString("base64")

const session = (): Json => ({
  available_models: [capiModel],
  selected_model: capiModel,
  session_token: "stub-session-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  discounted_costs: {}
})

const tiers = [{ id: "balance", display_name: "Balance", description: "Balance", type: "auto", status: { enabled: true } }]

const agents = (path: string): Json => {
  if (path.includes("/sessions")) {
    return { sessions: [], total_count: 0, page_size: 20, page_number: 1 }
  }
  if (path.includes("/swe/models")) {
    return { data: [model] }
  }
  return path.includes("/swe/") && !path.includes("/swe/custom-agents") ? {} : { agents: [] }
}

const models = (path: string): Json => {
  if (path === "/models") {
    return { data: [model] }
  }
  if (path === "/models/session") {
    return session()
  }
  if (path === "/models/session/intent") {
    return { model: capiModel }
  }
  return path.endsWith("/policy") ? { state: "accepted", terms: "" } : model
}

export const capiReply = (origin: string, path: string): Json => {
  if (path.startsWith("/copilot_internal/")) {
    return path.includes("token") ? token(origin) : {}
  }
  if (path === "/meta") {
    return { models: { data: [model] }, auto: { default_tier: "balance", tiers } }
  }
  if (path === "/models" || path.startsWith("/models/")) {
    return models(path)
  }
  if (path.startsWith("/agents")) {
    return agents(path)
  }
  return path === "/skills" || path.startsWith("/search/") || path.startsWith("/embeddings") ? { data: [] } : {}
}

export const stubbedCopilot = (origin: string, profile: string) => ({
  settings: {
    "github.copilot.advanced.debug.overrideProxyUrl": origin,
    "github.copilot.advanced.debug.overrideCapiUrl": origin,
    "github.copilot.advanced.debug.overrideAuthType": "token",
    "chat.allowAnonymousAccess": true,
    "github.copilot.chat.githubMcpServer.enabled": false,
    "chat.agentHost.unsafeTestToken": capiToken,
    "chat.defaultModel": capiModel
  },
  env: {
    HOME: join(profile, "home"),
    ASK_USER_FORM_E2E_TOOL_SEARCH: "1",
    GITHUB_PAT: "stub-pat",
    IS_SCENARIO_AUTOMATION: "1",
    VSCODE_COPILOT_CHAT_TOKEN: chatToken(origin),
    COPILOT_API_URL: origin,
    COPILOT_DEBUG_GITHUB_API_URL: origin,
    GITHUB_COPILOT_API_TOKEN: capiToken,
    VSCODE_AGENT_HOST_CAPI_URL_OVERRIDE: origin,
    XDG_STATE_HOME: join(profile, "state"),
    COPILOT_HOME: join(profile, "state", ".copilot"),
    ...(process.getuid?.() === 0 ? { IS_SANDBOX: "1" } : {}),
    ...(process.env["ASK_USER_FORM_OPENSSL_LIB"] === undefined ? {} : { LD_LIBRARY_PATH: process.env["ASK_USER_FORM_OPENSSL_LIB"] })
  }
})
