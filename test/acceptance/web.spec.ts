import { open } from "@vscode/test-web"
import { chromium, expect, type Frame, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { runCommand } from "./commands.ts"
import { test as base } from "./fixtures.ts"
import { formFrame, until } from "./frames.ts"
import { driver, electron, extension, webHost } from "./paths.ts"
import { desktopCommit, freePort } from "./server.ts"

interface Web {
  readonly page: Page
  readonly logs: ReadonlyArray<string>
}

const test = base.extend<object, { readonly web: Web }>({
  web: [
    async ({ platform: _platform }, use) => {
      const port = await freePort()
      const server = await open({
        browserType: "none",
        quality: "stable",
        commit: await desktopCommit(electron()),
        port,
        extensionDevelopmentPath: extension,
        extensionPaths: [driver],
        extensionTestsPath: webHost
      })
      const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"]
      const browser = await chromium.launch({ args: ["--no-sandbox"], ...(executablePath === undefined ? {} : { executablePath }) })
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
      page.setDefaultTimeout(30_000)
      const logs: Array<string> = []
      await page.exposeFunction("codeAutomationLog", (_type: string, args: ReadonlyArray<unknown>) => {
        logs.push(args.map(String).join(" "))
      })
      await page.exposeFunction("codeAutomationExit", () => null)
      await page.goto(`http://localhost:${port}`)
      await use({ page, logs })
      await browser.close()
      server.dispose()
    },
    { scope: "worker", timeout: 600_000 }
  ]
})

const invoke = async (web: Web): Promise<{ readonly frame: Frame; readonly result: () => Promise<string> }> => {
  const previous = web.page.frames()
  const index = web.logs.filter((line) => line.includes("ask-form-e2e invoked")).length + 1
  await runCommand(web.page, "Ask Form: Invoke acceptance form")
  const frame = await formFrame(web.page, previous)
  const marker = `ask-form-e2e result ${index} `
  return {
    frame,
    result: () =>
      until(
        () => {
          const line = web.logs.find((entry) => entry.includes(marker))
          return Promise.resolve(line?.slice(line.indexOf(marker) + marker.length))
        },
        `the tool call ${index} settles`,
        60_000
      )
  }
}

const closed = (frame: Frame) => expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true)

test.afterEach(async ({ web }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const screenshot = await web.page.screenshot({ timeout: 10_000 }).catch(() => null)
    if (screenshot !== null) {
      await testInfo.attach("page", { body: screenshot, contentType: "image/png" })
    }
    await testInfo.attach("logs", { body: web.logs.join("\n"), contentType: "text/plain" })
  }
  await runCommand(web.page, "Ask Form: Cancel acceptance form")
})

test("REQ-WEB-001 web版ではフォームを横のパネルに表示し、そこで回答するとツールの結果になる", async ({ web }) => {
  const { frame, result } = await invoke(web)
  await expect(frame.getByRole("textbox", { name: "イベント名" })).toHaveValue("技術交流会 2026")
  await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
  await frame.getByRole("spinbutton", { name: "参加者数" }).press("Tab")
  await frame.locator("form.card button.primary").click()
  await closed(frame)
  const text = await result()
  expect(text).toContain('"status":"submitted"')
  expect(text).toContain('"changedByUser":["attendees"]')
})

test("REQ-WEB-001 web版でツールの呼び出しを取り消すと、待機が終わる", async ({ web }) => {
  const { frame, result } = await invoke(web)
  await runCommand(web.page, "Ask Form: Cancel acceptance form", false)
  await closed(frame)
  expect(await result()).toMatch(/"status":"answer_in_chat"|Canceled/)
})

test("REQ-WAIT-001 web版でフォームが別のタブに隠れても、待機の表示から前面に出せ、キャンセルを押すとパネルが閉じる", async ({ web }) => {
  const { frame, result } = await invoke(web)
  const tab = web.page.locator(".tabs-container .tab", { hasText: eventSpec.title })
  await expect(tab).toHaveClass(/\bactive\b/)
  await runCommand(web.page, "File: New Untitled Text File", false)
  await expect(tab).not.toHaveClass(/\bactive\b/)
  await web.page.locator(".statusbar-item", { hasText: /回答を待っています|waiting for your answer/ }).click()
  await expect(tab).toHaveClass(/\bactive\b/)
  await frame.locator("form.card button.ghost").click()
  await closed(frame)
  expect(await result()).toContain('"status":"answer_in_chat"')
})
