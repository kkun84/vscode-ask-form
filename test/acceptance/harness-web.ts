import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eventSpec } from "../fixtures/event.ts"
import { until } from "./frames.ts"
import { smokeDriver, type Session } from "./harness-session.ts"
import { trigger } from "./session.ts"
import { stubbedCopilot } from "./stub-capi.ts"
import { startStubModel } from "./stub-model.ts"
import { webSession } from "./web-session.ts"

export const openWebHarness = async (results: string): Promise<Session> => {
  await mkdir(results, { recursive: true })
  const log = join(results, "driver-agents-web.log")
  await rm(log, { force: true })
  const agents = await startStubModel(trigger, eventSpec)
  const profile = await mkdtemp(join(tmpdir(), "ask-form-agents-web-"))
  await mkdir(join(profile, "home"), { recursive: true })
  const stub = stubbedCopilot(agents.origin, profile)
  const web = await webSession(profile, log, { ...stub.env, ASK_FORM_E2E_LOG: log }, [smokeDriver], {
    ...stub.settings,
    "workbench.startupEditor": "none"
  })
  const close = async (): Promise<void> => {
    await web.close()
    await agents.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  await until(
    async () => ((await web.events()).some((line) => line.endsWith("commands ready")) ? true : null),
    "the acceptance driver starts",
    180_000
  ).catch(async (error: unknown) => {
    await close()
    throw error
  })
  return { window: web.window, windows: () => web.window.context().pages(), agents, profile, log, close }
}
