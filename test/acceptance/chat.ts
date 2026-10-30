import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { _electron as electron, type ElectronApplication, type Frame, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts"

interface Paths {
  readonly executable: string
  readonly extension: string
  readonly driver: string
  readonly results: string
}

const trigger = "ASK_FORM_E2E"

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const until = async <T>(probe: () => Promise<T | null | undefined>, message: string, timeoutMs: number): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined && value !== null) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`)
    }
    await sleep(250)
  }
}

const formFrame = (window: Page): Promise<Frame> =>
  until(
    async () => {
      for (const frame of window.frames()) {
        const found = await frame
          .locator("form.card button.primary")
          .count()
          .catch(() => 0)
        if (found > 0) {
          return frame
        }
      }
      return null
    },
    "the form appears in the chat",
    120_000
  )

const launch = async (paths: Paths, llm: FakeLlm, log: string, profile: string): Promise<ElectronApplication> => {
  const user = join(profile, "user")
  await mkdir(join(user, "User", "globalStorage"), { recursive: true })
  const state = new DatabaseSync(join(user, "User", "globalStorage", "state.vscdb"))
  state.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)")
  state.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run("builtinChatExtensionEnablementMigration", "true")
  state.close()
  await mkdir(join(user, "User"), { recursive: true })
  await writeFile(
    join(user, "User", "settings.json"),
    JSON.stringify({
      "chat.mcp.apps.enabled": true,
      "workbench.startupEditor": "none",
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false
    })
  )
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
      env[key] = value
    }
  }
  return electron.launch({
    executablePath: paths.executable,
    args: [
      `--extensionDevelopmentPath=${paths.extension}`,
      `--extensionDevelopmentPath=${paths.driver}`,
      `--user-data-dir=${user}`,
      `--extensions-dir=${join(profile, "extensions")}`,
      "--disable-workspace-trust",
      "--disable-gpu",
      "--no-sandbox",
      "--skip-welcome",
      "--skip-release-notes",
      "--locale=en",
      "--password-store=basic"
    ],
    env: { ...env, ASK_FORM_E2E_LLM_URL: llm.url, ASK_FORM_E2E_QUERY: `${trigger} Please ask me with a form.`, ASK_FORM_E2E_LOG: log }
  })
}

const check = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

type Step = (session: Session) => Promise<void>

interface Session {
  readonly window: Page
  readonly llm: FakeLlm
  frame: Frame | undefined
}

const steps: Array<{ readonly name: string; readonly body: Step }> = []

const test = (name: string, body: Step): void => {
  steps.push({ name, body })
}

const waiting = (session: Session) => session.window.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

const theFrame = (session: Session): Frame => {
  if (session.frame === undefined) {
    throw new Error("the form has not appeared")
  }
  return session.frame
}

test("REQ-ASK-001 Copilotのチャットで、AIがフォームで質問できる", async (session) => {
  session.frame = await formFrame(session.window)
})

test("REQ-ASK-002 フォームにAIの推測値と根拠が表示される", async (session) => {
  const frame = theFrame(session)
  check((await frame.getByLabel("イベント名").inputValue()) === "技術交流会 2026", "the guessed value is filled in")
  await frame.getByText("README.mdより").waitFor({ timeout: 10_000 })
})

test("REQ-WAIT-001 回答を待つ間、ステータスバーに表示される", async (session) => {
  await waiting(session).waitFor({ timeout: 30_000 })
})

test("REQ-ANS-001 フォームで回答すると、同じ流れのままモデルに回答が届く", async (session) => {
  const frame = theFrame(session)
  await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
  await frame.getByRole("spinbutton", { name: "参加者数" }).press("Tab")
  await frame.locator("form.card button.primary").click()
  const result = await until(() => Promise.resolve(session.llm.toolResults[0]), "the model receives the answer", 60_000)
  check(result.includes('"status":"submitted"'), `the tool result is submitted: ${result}`)
  check(result.includes('"changedByUser":["attendees"]'), `the tool result marks the changed field: ${result}`)
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
})

test("REQ-RES-001 回答後のフォームは要約になる", async (session) => {
  await theFrame(session).locator(".summary").waitFor({ timeout: 30_000 })
})

const report = async (paths: Paths, session: Session, log: string): Promise<void> => {
  await session.window.screenshot({ path: join(paths.results, "chat-failure.png"), timeout: 10_000 }).catch(() => null)
  console.error(await readFile(log, "utf8").catch(() => "(no driver log)"))
  console.error(`fake LLM received ${session.llm.requests.length} request(s)`)
  for (const request of session.llm.requests) {
    console.error(
      JSON.stringify({
        tools: (request.tools ?? []).map((tool) => tool.function?.name),
        messages: (request.messages ?? []).map((message) => message.role)
      })
    )
  }
}

export const runChat = async (paths: Paths): Promise<void> => {
  await mkdir(paths.results, { recursive: true })
  const log = join(paths.results, "driver.log")
  await rm(log, { force: true })
  const llm = await startFakeLlm(trigger, eventSpec)
  const profile = await mkdtemp(join(tmpdir(), "ask-form-chat-"))
  let app: ElectronApplication | undefined
  try {
    app = await launch(paths, llm, log, profile)
    const window = await app.firstWindow({ timeout: 60_000 })
    window.context().setDefaultTimeout(30_000)
    const session: Session = { window, llm, frame: undefined }
    for (const { name, body } of steps) {
      try {
        await body(session)
        console.log(`ok ${name}`)
      } catch (error) {
        console.error(`not ok ${name}`)
        await report(paths, session, log)
        throw error
      }
    }
    await window.screenshot({ path: join(paths.results, "chat-answered.png"), timeout: 10_000 })
  } finally {
    if (app !== undefined) {
      await Promise.race([app.close().catch(() => null), sleep(10_000)])
      app.process().kill("SIGKILL")
    }
    await llm.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}
