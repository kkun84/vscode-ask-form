import { test as base, type TestInfo } from "@playwright/test"
import { openSession, type Platform, type Session } from "./session.ts"

export interface PlatformOptions {
  readonly platform: Platform
}

export const test = base.extend<object, PlatformOptions & { readonly session: Session }>({
  platform: ["desktop", { option: true, scope: "worker" }],
  session: [
    async ({ platform }, use, workerInfo) => {
      const session = await openSession(platform, workerInfo.project.outputDir, "shared")
      await use(session)
      await session.close()
    },
    { scope: "worker", timeout: 600_000 }
  ]
})

export const attachDiagnostics = async (session: Session, testInfo: TestInfo): Promise<void> => {
  const screenshot = await session.window.screenshot({ timeout: 10_000 }).catch(() => null)
  if (screenshot !== null) {
    await testInfo.attach("window", { body: screenshot, contentType: "image/png" })
  }
  const text = await session.window
    .locator(".interactive-session")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "(no chat text)")
  await testInfo.attach("chat", { body: text, contentType: "text/plain" })
  await testInfo.attach("driver-events", { body: (await session.events()).join("\n"), contentType: "text/plain" })
  const { llm } = session
  await testInfo.attach("stub-model", {
    body: JSON.stringify({ toolCalls: llm.toolCalls, toolResults: llm.toolResults, toolNames: llm.toolNames }, undefined, 2),
    contentType: "application/json"
  })
}
