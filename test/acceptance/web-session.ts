import { readFile } from "node:fs/promises"
import { chromium, type Page } from "@playwright/test"
import { open as openWeb } from "@vscode/test-web"
import { driver, driverVsix, electron, extension, vsix, webHost } from "./paths.ts"
import { desktopCommit, ensureServer, freePort, startServer } from "./server.ts"

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

export const webSession = async (profile: string, log: string, env: Readonly<Record<string, string>>): Promise<Running> => {
  const commit = await desktopCommit(electron())
  const server = await startServer(commit, {
    directory: await ensureServer(commit),
    profile,
    extensions: [vsix, driverVsix],
    env
  })
  const browser = await launchBrowser()
  const context = await browser.newContext({ viewport: size, bypassCSP: true })
  context.setDefaultTimeout(30_000)
  await context.addInitScript(patchWorkbench)
  const window = await context.newPage()
  await window.goto(`${server.origin}/version`)
  await window.evaluate(completeChatSetup)
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

export const browserSession = async (): Promise<Running> => {
  const port = await freePort()
  const server = await openWeb({
    browserType: "none",
    quality: "stable",
    commit: await desktopCommit(electron()),
    port,
    extensionDevelopmentPath: extension,
    extensionPaths: [driver],
    extensionTestsPath: webHost
  })
  const browser = await launchBrowser()
  const window = await browser.newPage({ viewport: size })
  window.setDefaultTimeout(30_000)
  const logged: Array<string> = []
  await window.exposeFunction("codeAutomationLog", (_type: string, args: ReadonlyArray<unknown>) => {
    logged.push(args.map(String).join(" "))
  })
  await window.exposeFunction("codeAutomationExit", () => null)
  await window.goto(`http://localhost:${port}`)
  return {
    window,
    events: () => Promise.resolve(logged),
    close: async () => {
      await browser.close()
      server.dispose()
    }
  }
}
