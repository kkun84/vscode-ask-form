import { readFile } from "node:fs/promises"
import { chromium, type Page } from "@playwright/test"
import { driverVsix, electron, vsix } from "./paths.ts"
import { desktopCommit, ensureServer, startServer } from "./server.ts"

export interface Running {
  readonly window: Page
  readonly events: () => Promise<ReadonlyArray<string>>
  readonly close: () => Promise<void>
}

export const size = { width: 1600, height: 1000 }
export const lines = (log: string) => (): Promise<ReadonlyArray<string>> =>
  readFile(log, "utf8").then(
    (text) => text.split("\n"),
    () => []
  )

const launchBrowser = () => {
  const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
  return chromium.launch({
    args: ["--no-sandbox", "--host-resolver-rules=MAP *.localhost 127.0.0.1"],
    ...(executablePath === undefined ? {} : { executablePath })
  })
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

interface Stored {
  readonly database: string
  readonly version?: number
  readonly stores: ReadonlyArray<string>
  readonly store: string
  readonly key: string
  readonly text: string
  readonly bytes: boolean
}

const store = (item: Stored): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(item.database, item.version)
    open.addEventListener("upgradeneeded", () => {
      for (const name of item.stores) {
        open.result.createObjectStore(name)
      }
    })
    open.addEventListener("error", () => reject(new Error(String(open.error))))
    open.addEventListener("success", () => {
      const transaction = open.result.transaction(item.store, "readwrite")
      transaction.objectStore(item.store).put(item.bytes ? new TextEncoder().encode(item.text) : item.text, item.key)
      transaction.addEventListener("complete", () => {
        open.result.close()
        resolve()
      })
      transaction.addEventListener("error", () => reject(new Error(String(transaction.error))))
    })
  })

const chatSetup: Stored = {
  database: "vscode-web-state-db-global",
  stores: ["ItemTable"],
  store: "ItemTable",
  key: "builtinChatExtensionEnablementMigration",
  text: "true",
  bytes: false
}

const userSettings = (settings: Readonly<Record<string, unknown>>): Stored => ({
  database: "vscode-web-db",
  version: 3,
  stores: ["vscode-userdata-store", "vscode-logs-store", "vscode-filehandles-store"],
  store: "vscode-userdata-store",
  key: "/User/settings.json",
  text: JSON.stringify(settings),
  bytes: true
})

export const webSession = async (
  profile: string,
  log: string,
  env: Readonly<Record<string, string>>,
  args: ReadonlyArray<string> = [],
  settings: Readonly<Record<string, unknown>> = {}
): Promise<Running> => {
  const commit = await desktopCommit(electron())
  const server = await startServer(commit, {
    directory: await ensureServer(commit),
    profile,
    extensions: [vsix, driverVsix],
    env,
    args
  })
  const browser = await launchBrowser()
  const context = await browser.newContext({ viewport: size, bypassCSP: true })
  context.setDefaultTimeout(30_000)
  await context.addInitScript(patchWorkbench)
  const window = await context.newPage()
  await window.goto(`${server.origin}/version`)
  await window.evaluate(store, chatSetup)
  await window.evaluate(store, userSettings(settings))
  await window.goto(server.origin)
  return {
    window,
    events: lines(log),
    close: async () => {
      await browser.close()
      await server.close()
    }
  }
}
