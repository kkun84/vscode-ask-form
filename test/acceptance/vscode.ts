import { mkdir, rm, writeFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test"
import type { FakeLlm } from "./fake-llm.ts"
import { sleep } from "./frames.ts"

export interface VscodePaths {
  readonly executable: string
  readonly extension: string
  readonly driver: string
}

export interface LaunchOptions {
  readonly llm: FakeLlm
  readonly log: string
  readonly profile: string
  readonly locale: string
  readonly query: string
  readonly settings?: Readonly<Record<string, unknown>>
  readonly video?: { readonly dir: string; readonly size: { readonly width: number; readonly height: number } }
}

const prepareProfile = async (user: string, settings: Readonly<Record<string, unknown>>): Promise<void> => {
  await mkdir(join(user, "User", "globalStorage"), { recursive: true })
  const state = new DatabaseSync(join(user, "User", "globalStorage", "state.vscdb"))
  state.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)")
  state.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("builtinChatExtensionEnablementMigration", "true")
  state.close()
  await writeFile(
    join(user, "User", "settings.json"),
    JSON.stringify({
      "chat.mcp.apps.enabled": true,
      "workbench.startupEditor": "none",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
      ...settings
    })
  )
}

export const launchVscode = async (paths: VscodePaths, options: LaunchOptions): Promise<ElectronApplication> => {
  const user = join(options.profile, "user")
  await prepareProfile(user, options.settings ?? {})
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
      env[key] = value
    }
  }
  return electron.launch({
    executablePath: paths.executable,
    args: [
      `--extensionDevelopmentPath=${paths.extension}`,
      `--extensionDevelopmentPath=${paths.driver}`,
      `--user-data-dir=${user}`,
      `--extensions-dir=${join(options.profile, "extensions")}`,
      "--disable-workspace-trust",
      "--disable-gpu",
      "--no-sandbox",
      "--skip-welcome",
      "--skip-release-notes",
      `--locale=${options.locale}`,
      "--password-store=basic"
    ],
    env: { ...env, ASK_FORM_E2E_LLM_URL: options.llm.url, ASK_FORM_E2E_QUERY: options.query, ASK_FORM_E2E_LOG: options.log },
    ...(options.video === undefined ? {} : { recordVideo: options.video })
  })
}

export const fitWindow = async (app: ElectronApplication, size: { readonly width: number; readonly height: number }): Promise<Page> => {
  const window = await app.firstWindow({ timeout: 60_000 })
  await app.evaluate(({ BrowserWindow }, bounds) => {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      browserWindow.setBounds({ x: 0, y: 0, ...bounds })
    }
  }, size)
  return window
}

export const closeApp = async (app: ElectronApplication): Promise<void> => {
  const closed = await Promise.race([
    app
      .close()
      .then(() => true)
      .catch(() => false),
    sleep(10_000).then(() => false)
  ])
  if (!closed) {
    app.process().kill("SIGKILL")
  }
}

export const cleanUp = async (app: ElectronApplication | undefined, llm: FakeLlm, profile: string): Promise<void> => {
  if (app !== undefined) {
    await closeApp(app)
  }
  await llm.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
