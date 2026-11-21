import { defineConfig } from "@playwright/test"
import type { PlatformOptions } from "./test/acceptance/fixtures.ts"

export default defineConfig<object, PlatformOptions>({
  testDir: "test/acceptance",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/acceptance",
  globalSetup: "./test/acceptance/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 240_000,
  reporter: process.env["CI"] === undefined ? [["list"]] : [["list"], ["github"]],
  projects: [
    { name: "browser", testMatch: /(startup|tool)\.spec\.ts$/, use: { platform: "browser" } },
    { name: "web", testMatch: /(startup|tool|chat)\.spec\.ts$/, use: { platform: "web" } },
    { name: "desktop", testMatch: /(startup|tool|chat|harness)\.spec\.ts$/, use: { platform: "desktop" } }
  ]
})
