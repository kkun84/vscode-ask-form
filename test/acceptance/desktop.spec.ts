import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCommand } from "./commands.ts"
import { test } from "./fixtures.ts"
import { until } from "./frames.ts"
import { driver, electron, extension, vsix } from "./paths.ts"
import { closeApp, fitWindow, launchVscode } from "./vscode.ts"

test("REQ-PERF-001 デスクトップ版は起動完了後に自動で有効になる", async ({ platform: _platform }, testInfo) => {
  await mkdir(testInfo.project.outputDir, { recursive: true })
  const log = join(testInfo.project.outputDir, "driver-desktop.log")
  await rm(log, { force: true })
  const profile = await mkdtemp(join(tmpdir(), "ask-form-desktop-"))
  const app = await launchVscode({ executable: electron(), extension, driver, vsix }, { log, profile, locale: "en" })
  try {
    const window = await fitWindow(app, { width: 1600, height: 1000 })
    window.context().setDefaultTimeout(30_000)
    await until(
      async () => {
        await runCommand(window, "Ask Form: Report acceptance state")
        const text = await readFile(log, "utf8").catch(() => "")
        return text.includes("state active=true tool=true") ? true : null
      },
      "Ask Form is active and its tool is registered without being called",
      60_000
    )
  } finally {
    await closeApp(app)
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
})
