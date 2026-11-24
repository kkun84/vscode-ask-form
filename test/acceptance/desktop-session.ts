import type { Page } from "@playwright/test"
import { until } from "./frames.ts"
import { driver, electron, extension, vsix } from "./paths.ts"
import { sshWindow } from "./ssh-host.ts"
import type { StubModel } from "./stub-model.ts"
import { closeApp, fitWindow, launchVscode, localHarness } from "./vscode.ts"
import { lines, size, type Running } from "./web-session.ts"

export const desktopSession = async (llm: StubModel, profile: string, log: string, query: string): Promise<Running> => {
  const app = await launchVscode(
    { executable: electron(), extension, driver, vsix },
    { llm, log, profile, locale: "en", query, settings: localHarness, autostart: false }
  )
  const window = await fitWindow(app, size)
  window.context().setDefaultTimeout(30_000)
  return { window, events: lines(log), pid: app.process().pid, close: () => closeApp(app) }
}

const modelOffered = (window: Page): Promise<true> => {
  const empty = window.locator(".interactive-input-part").getByText("Models", { exact: true })
  let offered = 0
  return until(
    async () => {
      offered = (await empty.isVisible().catch(() => true)) ? 0 : offered + 1
      return offered >= 3 ? (true as const) : null
    },
    "the chat offers the stub model",
    120_000
  )
}

export const sshSession = async (llm: StubModel, profile: string, log: string, query: string): Promise<Running> => {
  const remote = await sshWindow(profile)
  const app = await launchVscode(
    { executable: electron(), extension, driver, vsix },
    {
      llm,
      log,
      profile,
      locale: "en",
      query,
      autostart: false,
      extensions: remote.extensions,
      args: remote.args,
      settings: { ...localHarness, ...remote.settings }
    }
  )
  const window = await fitWindow(app, size)
  window.context().setDefaultTimeout(30_000)
  return {
    window,
    events: lines(log),
    ready: () => modelOffered(window),
    close: async () => {
      await closeApp(app)
      await remote.close()
    }
  }
}
