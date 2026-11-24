import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { until } from "./frames.ts"
import { startStubModel, type StubModel } from "./stub-model.ts"
import { desktopSession, sshSession } from "./desktop-session.ts"
import { localHarness } from "./vscode.ts"
import { webSession, type Running } from "./web-session.ts"

export type Platform = "desktop" | "web" | "ssh"

export interface Session {
  readonly window: Page
  readonly llm: StubModel
  readonly events: () => Promise<ReadonlyArray<string>>
  readonly pid?: number | undefined
  readonly close: () => Promise<void>
}

export const askedSpec = { ...eventSpec, description: `${eventSpec.description}${"The form explains itself at length. ".repeat(9)}` }

export const trigger = "ASK_USER_FORM_E2E"

const query = `${trigger} Please ask me with a form.`

const driverReady = (session: Running, marker: string): Promise<true> =>
  until(
    async () => ((await session.events()).some((line) => line.endsWith(marker)) ? (true as const) : null),
    `the acceptance driver reports ${marker}`,
    180_000
  )

const launch = (platform: Platform, llm: StubModel, profile: string, log: string): Promise<Running> => {
  if (platform === "desktop") {
    return desktopSession(llm, profile, log, query)
  }
  if (platform === "ssh") {
    return sshSession(llm, profile, log, query)
  }
  return webSession(profile, log, {
    ASK_USER_FORM_E2E_LLM_URL: llm.url,
    ASK_USER_FORM_E2E_QUERY: query,
    ASK_USER_FORM_E2E_LOG: log,
    ASK_USER_FORM_E2E_AUTOSTART: "0",
    ASK_USER_FORM_E2E_SETTINGS: JSON.stringify({ ...localHarness, "workbench.startupEditor": "none" })
  })
}

export const openSession = async (platform: Platform, results: string, name: string): Promise<Session> => {
  await mkdir(results, { recursive: true })
  const log = join(results, `driver-${platform}-${name}.log`)
  await rm(log, { force: true })
  const llm = await startStubModel(trigger, askedSpec)
  const profile = await mkdtemp(join(tmpdir(), `ask-user-form-${platform}-`))
  const session = await launch(platform, llm, profile, log)
  const close = async (): Promise<void> => {
    await session.close()
    await llm.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  await driverReady(session, "chat ready")
    .then(() => session.ready?.())
    .catch(async (error: unknown) => {
      await close()
      throw error
    })
  return { ...session, llm, close }
}
