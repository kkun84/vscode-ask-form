import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Page } from "@playwright/test"
import { until } from "./frames.ts"
import { driver, driverVsix, electron, extension, vsix } from "./paths.ts"
import { desktopCommit, ensureServer, startServer } from "./server.ts"
import { startStubModel, type StubModel } from "./stub-model.ts"
import { closeApp, fitWindow, launchVscode, localHarness } from "./vscode.ts"

export type Platform = "desktop" | "web"

export interface ChatSession {
  readonly window: Page
  readonly llm: StubModel
  readonly log: string
  readonly close: () => Promise<void>
}

export const trigger = "ASK_FORM_E2E"

const query = `${trigger} Please ask me with a form.`

const size = { width: 1600, height: 1000 }

const driverReady = (log: string): Promise<true> =>
  until(
    () =>
      readFile(log, "utf8").then(
        (text) => (/ ready$/m.test(text) ? (true as const) : null),
        () => null
      ),
    "the acceptance driver registers its commands",
    180_000
  )

const desktopChat = async (llm: StubModel, profile: string, log: string): Promise<ChatSession> => {
  const app = await launchVscode(
    { executable: electron(), extension, driver, vsix },
    { llm, log, profile, locale: "en", query, settings: localHarness, autostart: false }
  )
  const window = await fitWindow(app, size)
  window.context().setDefaultTimeout(30_000)
  return { window, llm, log, close: () => closeApp(app) }
}

const patchWorkbench = (): void => {
  new MutationObserver((_records, observer) => {
    const meta = document.querySelector<HTMLElement>("#vscode-workbench-web-configuration")
    if (meta === null) {
      return
    }
    observer.disconnect()
    const text = meta.dataset["settings"] ?? "{}"
    const commit = /stable-([0-9a-f]{40})/.exec(text)?.[1] ?? ""
    const config = JSON.parse(text) as Record<string, unknown>
    config["webviewEndpoint"] =
      `http://{{uuid}}.localhost:${location.port}/stable-${commit}/static/out/vs/workbench/contrib/webview/browser/pre/`
    config["enableWorkspaceTrust"] = false
    meta.dataset["settings"] = JSON.stringify(config)
  }).observe(document, { childList: true, subtree: true })
}

const completeChatSetup = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("vscode-web-state-db-global")
    open.addEventListener("upgradeneeded", () => {
      open.result.createObjectStore("ItemTable")
    })
    open.addEventListener("error", () => reject(new Error(String(open.error))))
    open.addEventListener("success", () => {
      const transaction = open.result.transaction("ItemTable", "readwrite")
      transaction.objectStore("ItemTable").put("true", "builtinChatExtensionEnablementMigration")
      transaction.addEventListener("complete", () => {
        open.result.close()
        resolve()
      })
      transaction.addEventListener("error", () => reject(new Error(String(transaction.error))))
    })
  })

const webChat = async (llm: StubModel, profile: string, log: string): Promise<ChatSession> => {
  const commit = await desktopCommit(electron())
  const server = await startServer(commit, {
    directory: await ensureServer(commit),
    profile,
    extensions: [vsix, driverVsix],
    env: {
      ASK_FORM_E2E_LLM_URL: llm.url,
      ASK_FORM_E2E_QUERY: query,
      ASK_FORM_E2E_LOG: log,
      ASK_FORM_E2E_AUTOSTART: "0",
      ASK_FORM_E2E_SETTINGS: JSON.stringify({ ...localHarness, "workbench.startupEditor": "none" })
    }
  })
  const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--host-resolver-rules=MAP *.localhost 127.0.0.1"],
    ...(executablePath === undefined ? {} : { executablePath })
  })
  const context = await browser.newContext({ viewport: size, bypassCSP: true })
  context.setDefaultTimeout(30_000)
  await context.addInitScript(patchWorkbench)
  const window = await context.newPage()
  await window.goto(`${server.origin}/version`)
  await window.evaluate(completeChatSetup)
  await window.goto(server.origin)
  return {
    window,
    llm,
    log,
    close: async () => {
      await browser.close()
      await server.close()
    }
  }
}

export const openChatSession = async (
  platform: Platform,
  spec: Readonly<Record<string, unknown>>,
  results: string
): Promise<ChatSession> => {
  await mkdir(results, { recursive: true })
  const log = join(results, `driver-${platform}.log`)
  await rm(log, { force: true })
  const llm = await startStubModel(trigger, spec)
  const profile = await mkdtemp(join(tmpdir(), `ask-form-${platform}-`))
  const session = await (platform === "desktop" ? desktopChat(llm, profile, log) : webChat(llm, profile, log))
  const close = async (): Promise<void> => {
    await session.close()
    await llm.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  await driverReady(log).catch(async (error: unknown) => {
    await close()
    throw error
  })
  return { ...session, close }
}
