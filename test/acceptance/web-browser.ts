import { mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { chromium, expect, type Browser, type Page } from "@playwright/test"
import { open } from "@vscode/test-web"
import { formFrame } from "./frames.ts"

export interface WebPaths {
  readonly electron: string
  readonly extension: string
  readonly tests: string
  readonly results: string
}

const port = 3157

const desktopCommit = async (electron: string): Promise<string> => {
  const candidates = [join(dirname(electron), "resources/app/product.json"), join(dirname(electron), "../Resources/app/product.json")]
  for (const candidate of candidates) {
    const product = await readFile(candidate, "utf8").catch(() => null)
    if (product !== null) {
      return (JSON.parse(product) as { readonly commit: string }).commit
    }
  }
  throw new Error(`product.json not found next to ${electron}`)
}

const answer = async (page: Page): Promise<void> => {
  const frame = await formFrame(page)
  await expect(frame.getByLabel("イベント名")).toHaveValue("技術交流会 2026")
  await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
  await frame.getByRole("spinbutton", { name: "参加者数" }).press("Tab")
  await frame.locator("form.card button.primary").click()
  await frame.locator(".summary").waitFor({ timeout: 30_000 })
  console.log("browser answered the form")
}

const report = async (page: Page, results: string): Promise<void> => {
  await page.screenshot({ path: join(results, "web-failure.png") }).catch(() => null)
  for (const frame of page.frames()) {
    const text = await frame
      .locator("body")
      .innerText({ timeout: 2000 })
      .catch(() => "")
    if (text.trim() !== "") {
      console.error(`frame ${frame.url().slice(0, 80)}: ${text.replaceAll(/\s+/g, " ").slice(0, 400)}`)
    }
  }
}

const drive = (browser: Browser, endpoint: string, results: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const run = async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
      page.setDefaultTimeout(30_000)
      await page.exposeFunction("codeAutomationLog", (type: "log" | "error" | "warn" | "info", args: ReadonlyArray<unknown>) => {
        console[type](...args)
      })
      await page.exposeFunction("codeAutomationExit", (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          void report(page, results).then(() => reject(new Error(`web acceptance tests failed with exit code ${code}`)))
        }
      })
      await page.goto(endpoint)
      await answer(page).catch(async (error: unknown) => {
        await report(page, results)
        reject(error)
      })
    }
    run().catch(reject)
  })

export const runWeb = async (paths: WebPaths): Promise<void> => {
  await mkdir(paths.results, { recursive: true })
  const server = await open({
    browserType: "none",
    quality: "stable",
    commit: await desktopCommit(paths.electron),
    port,
    extensionDevelopmentPath: paths.extension,
    extensionTestsPath: paths.tests
  })
  const browser = await chromium.launch({ args: ["--no-sandbox"] })
  try {
    await drive(browser, `http://localhost:${port}`, paths.results)
  } finally {
    await browser.close()
    server.dispose()
  }
}
