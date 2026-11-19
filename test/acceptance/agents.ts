import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type ElectronApplication, type Frame, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeAgents, type FakeAgents } from "./fake-agents.ts"
import { formFrame, settled, until } from "./frames.ts"
import { cleanUp, fitWindow, launchVscode, type VscodePaths } from "./vscode.ts"

interface Paths extends VscodePaths {
  readonly results: string
  readonly sdkCache: string
}

const trigger = "ASK_FORM_E2E"

interface Session {
  readonly window: Page
  readonly agents: FakeAgents
}

type Harness = "Claude" | "Codex"

const steps: Array<{ readonly name: string; readonly body: (session: Session) => Promise<void> }> = []

const test = (name: string, body: (session: Session) => Promise<void>): void => {
  steps.push({ name, body })
}

const waiting = (session: Session) => session.window.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

const runCommand = async (session: Session, title: string): Promise<void> => {
  await session.window.keyboard.press("F1")
  await session.window.locator(".quick-input-widget input").fill(`>${title}`)
  await session.window.locator(".quick-input-list .monaco-list-row", { hasText: title }).click()
}

const openSession = async (session: Session, harness: Harness): Promise<void> => {
  await runCommand(session, `Ask Form: New acceptance ${harness} session`)
  const input = session.window.locator(".interactive-input-part .monaco-editor")
  const download = session.window.locator(".monaco-button", { hasText: /^Download$/ })
  await Promise.race([input.waitFor({ timeout: 60_000 }), download.waitFor({ timeout: 60_000 })])
  if (await download.isVisible()) {
    await download.click()
    await download.waitFor({ state: "hidden", timeout: 300_000 })
  }
}

const ask = async (session: Session, harness: Harness): Promise<{ readonly frame: Frame; readonly callId: string }> => {
  const previous = session.window.frames()
  const callIndex = session.agents.toolCalls.length
  await openSession(session, harness)
  await session.window.locator(".interactive-input-part .monaco-editor").click()
  await session.window.keyboard.type(`${trigger} Please ask me with a form.`)
  await session.window.keyboard.press("Enter")
  const allow = session.window.locator(".monaco-button", { hasText: "Allow in this Session" })
  await allow.waitFor({ timeout: 120_000 })
  await allow.click()
  const call = await until(() => Promise.resolve(session.agents.toolCalls[callIndex]), `${harness} calls ask_form`, 120_000)
  const frame = await formFrame(session.window, previous)
  return { frame, callId: call.id }
}

const resultOf = (session: Session, callId: string) =>
  until(
    () => Promise.resolve(session.agents.toolResults.find((item) => item.id === callId)),
    `the model receives the answer for ${callId}`,
    60_000
  )

const answeredInPanel = (harness: Harness) => async (session: Session) => {
  const { frame, callId } = await ask(session, harness)
  await waiting(session).waitFor({ timeout: 30_000 })
  await settled(frame)
  const attendees = frame.getByRole("spinbutton", { name: "参加者数" })
  await attendees.fill("150")
  await attendees.press("Tab")
  await frame.getByRole("button", { name: "Send", exact: true }).click()
  const result = await resultOf(session, callId)
  expect(result.text).toContain('"status":"submitted"')
  expect(result.text).toContain('"changedByUser":["attendees"]')
  await until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the panel closes", 30_000)
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
  await session.window.getByText("FAKE_AGENT_DONE", { exact: true }).waitFor({ timeout: 60_000 })
}

test("REQ-ENV-002 Claudeのハーネスでは、フォームがチャットの横のパネルに出て、回答がモデルに届く", answeredInPanel("Claude"))

test("REQ-ENV-002 Claudeのハーネスでチャットを停止すると、パネルが閉じる", async (session) => {
  const { frame } = await ask(session, "Claude")
  await waiting(session).waitFor({ timeout: 30_000 })
  await session.window.locator(".interactive-input-part .codicon-stop-circle").click()
  await until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the panel closes", 30_000)
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
})

test("REQ-ENV-002 Codexのハーネスでは、フォームがチャットの横のパネルに出て、回答がモデルに届く", answeredInPanel("Codex"))

const prepareCodex = async (home: string, origin: string): Promise<void> => {
  await mkdir(home, { recursive: true })
  await writeFile(join(home, "config.toml"), `openai_base_url = "${origin}/v1"\n`)
  await writeFile(join(home, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-fake" }))
}

export const runAgents = async (paths: Paths): Promise<void> => {
  await mkdir(paths.results, { recursive: true })
  await mkdir(paths.sdkCache, { recursive: true })
  const log = join(paths.results, "driver.log")
  await rm(log, { force: true })
  const agents = await startFakeAgents(trigger, eventSpec)
  const profile = await mkdtemp(join(tmpdir(), "ask-form-agents-"))
  let app: ElectronApplication | undefined
  try {
    const home = join(profile, "home")
    const folder = join(profile, "workspace")
    await mkdir(home, { recursive: true })
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, "README.md"), "acceptance\n")
    await mkdir(join(profile, "user", "agent-host"), { recursive: true })
    await symlink(paths.sdkCache, join(profile, "user", "agent-host", "sdk-cache"))
    await prepareCodex(join(profile, "codex"), agents.origin)
    app = await launchVscode(paths, {
      log,
      profile,
      locale: "en",
      folder,
      settings: {
        "chat.agentHost.claudeAgent.enabled": true,
        "chat.agentHost.codexAgent.enabled": true,
        "chat.editor.codex.preferAgentHost": true
      },
      env: {
        HOME: home,
        ANTHROPIC_BASE_URL: agents.origin,
        ANTHROPIC_API_KEY: "sk-ant-fake",
        CODEX_HOME: join(profile, "codex"),
        ...(process.getuid?.() === 0 ? { IS_SANDBOX: "1" } : {})
      }
    })
    const window = await fitWindow(app, { width: 1600, height: 1000 })
    window.context().setDefaultTimeout(30_000)
    const session: Session = { window, agents }
    for (const { name, body } of steps) {
      try {
        await body(session)
        console.log(`ok ${name}`)
      } catch (error) {
        console.error(`not ok ${name}`)
        await window.screenshot({ path: join(paths.results, "agents-failure.png"), timeout: 10_000 }).catch(() => null)
        await writeFile(
          join(paths.results, "agents-llm.json"),
          JSON.stringify({ toolCalls: agents.toolCalls, toolResults: agents.toolResults, toolNames: agents.toolNames }, undefined, 2)
        )
        throw error
      }
    }
  } finally {
    await cleanUp(app, agents, profile)
  }
}
