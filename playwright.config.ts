import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "test/system",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  timeout: 15_000,
  globalTimeout: 120_000,
  reporter: process.env["CI"] === undefined ? [["list"]] : [["list"], ["github"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" }
  },
  snapshotPathTemplate: "test/system/__screenshots__/{arg}{ext}",
  use: {
    browserName: "chromium",
    viewport: { width: 520, height: 900 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    launchOptions:
      process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] === undefined ? {} : { executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"] }
  }
})
