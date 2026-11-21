import { test as base } from "@playwright/test"
import type { Platform } from "./session.ts"

export interface PlatformOptions {
  readonly platform: Platform
}

export const test = base.extend<object, PlatformOptions>({
  platform: ["desktop", { option: true, scope: "worker" }]
})
