import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ElectronApplication, Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { driver, electron, extension, sdkCache, vsix } from "./paths.ts"
import { trigger } from "./session.ts"
import { startStubModel, type StubModel } from "./stub-model.ts"
import { closeApp, fitWindow, launchVscode } from "./vscode.ts"

export interface Session {
  readonly app: ElectronApplication
  readonly window: Page
  readonly agents: StubModel
  readonly profile: string
  readonly log: string
  readonly close: () => Promise<void>
}

export const agentHostLog = async (profile: string): Promise<string> => {
  const logs = join(profile, "user", "logs")
  const sessions = await readdir(logs).catch(() => [])
  const latest = sessions.toSorted().at(-1)
  const text = latest === undefined ? "" : await readFile(join(logs, latest, "agenthost.log"), "utf8").catch(() => "")
  return text
    .split("\n")
    .filter((line) => /\[(Codex|Claude)\]|error/i.test(line))
    .slice(-40)
    .join("\n")
}

const prepareCodex = async (home: string, origin: string): Promise<void> => {
  await mkdir(home, { recursive: true })
  await writeFile(join(home, "config.toml"), `openai_base_url = "${origin}/v1"\n`)
  await writeFile(join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-stub" }))
}

export const openAgentsSession = async (results: string): Promise<Session> => {
  await mkdir(results, { recursive: true })
  await mkdir(sdkCache, { recursive: true })
  const log = join(results, "driver-agents.log")
  await rm(log, { force: true })
  const agents = await startStubModel(trigger, eventSpec)
  const profile = await mkdtemp(join(tmpdir(), "ask-form-agents-"))
  const home = join(profile, "home")
  const folder = join(profile, "workspace")
  await mkdir(home, { recursive: true })
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "README.md"), "acceptance\n")
  await mkdir(join(profile, "user", "agent-host"), { recursive: true })
  await symlink(sdkCache, join(profile, "user", "agent-host", "sdk-cache"))
  await prepareCodex(join(profile, "codex"), agents.origin)
  const app = await launchVscode(
    { executable: electron(), extension, driver, vsix },
    {
      log,
      profile,
      locale: "en",
      folder,
      settings: {
        "chat.agentHost.codexAgent.enabled": true,
        "chat.editor.codex.preferAgentHost": true,
        "chat.agentHost.copilot.modelCapabilityOverrides": { "*": { family: "gpt-5.5" } }
      },
      env: {
        HOME: home,
        CODEX_HOME: join(profile, "codex"),
        ASK_FORM_E2E_BYOK_URL: `${agents.origin}/v1/chat/completions`,
        ASK_FORM_E2E_TOOL_SEARCH: "1",
        ...(process.getuid?.() === 0 ? { IS_SANDBOX: "1" } : {}),
        ...(process.env["ASK_FORM_OPENSSL_LIB"] === undefined ? {} : { LD_LIBRARY_PATH: process.env["ASK_FORM_OPENSSL_LIB"] })
      }
    }
  )
  const window = await fitWindow(app, { width: 1600, height: 1000 })
  window.context().setDefaultTimeout(30_000)
  return {
    app,
    window,
    agents,
    profile,
    log,
    close: async () => {
      await closeApp(app)
      await agents.close()
      await rm(profile, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}
