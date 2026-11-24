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
    { name: "web", testMatch: /(startup|tool|chat|kinds)\.spec\.ts$/, use: { platform: "web" } },
    { name: "ssh", testMatch: /(startup|tool|chat|kinds)\.spec\.ts$/, use: { platform: "ssh" } },
    { name: "desktop", testMatch: /(startup|tool|chat|kinds|desktop)\.spec\.ts$/, use: { platform: "desktop" } },
    { name: "harness", testMatch: /harness\.spec\.ts$/, use: { platform: "desktop" } }
  ]
})
