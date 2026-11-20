import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type ElectronApplication, type Frame, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeAgents, type FakeAgents } from "./fake-agents.ts"
import { formFrame, settled, sleep, until } from "./frames.ts"
import { createSteps, printChat, waitingStatus } from "./steps.ts"
import { cleanUp, fitWindow, launchVscode, type VscodePaths } from "./vscode.ts"

interface Paths extends VscodePaths {
  readonly results: string
  readonly sdkCache: string
}

const trigger = "ASK_FORM_E2E"

interface Session {
  readonly app: ElectronApplication
  readonly window: Page
  readonly agents: FakeAgents
}

type Harness = "Codex" | "Copilot"

const { test, run } = createSteps<Session>()

const waiting = (page: Page) => waitingStatus(page)

const runCommand = async (page: Page, title: string): Promise<void> => {
  const input = page.locator(".quick-input-widget input")
  const row = page.locator(".quick-input-list .monaco-list-row", { hasText: title })
  await until(
    async () => {
      await page.keyboard.press("Escape")
      await page.locator(".monaco-workbench").click({ position: { x: 600, y: 400 } })
      await page.keyboard.press("F1")
      if (!(await input.isVisible().catch(() => false))) {
        return null
      }
      await input.fill(`>${title}`)
      return (await row.isVisible().catch(() => false)) ? true : undefined
    },
    `the command palette offers ${title}`,
    120_000
  )
  await row.click()
}

const modelReady = async (page: Page, harness: Harness): Promise<void> => {
  const download = page.locator(".monaco-button:visible", { hasText: /^Download$/ })
  const noModel = page.locator(".interactive-input-part").getByText("Models", { exact: true })
  let ready = 0
  await until(
    async () => {
      if (await download.isVisible().catch(() => false)) {
        await download.click()
        await download.waitFor({ state: "hidden", timeout: 300_000 })
      }
      ready = (await noModel.isVisible().catch(() => true)) ? 0 : ready + 1
      return ready >= 3 ? true : undefined
    },
    `the ${harness} harness offers a model`,
    360_000
  )
}

const openSession = async (session: Session, harness: Harness): Promise<Page> => {
  await runCommand(session.window, `Ask Form: New acceptance ${harness} session`)
  await modelReady(session.window, harness)
  return session.window
}

const send = async (page: Page): Promise<void> => {
  const editor = page.locator(".interactive-input-part .monaco-editor:visible").first()
  await editor.click()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.press("Backspace")
  await page.keyboard.type(`${trigger} Please ask me with a form.`)
  await until(
    async () => {
      if (!(await editor.innerText()).includes(trigger)) {
        return true
      }
      await editor.click()
      await page.keyboard.press("Enter")
      await sleep(2000)
      return null
    },
    "the chat accepts the request",
    60_000
  )
}

const ask = async (
  session: Session,
  harness: Harness,
  open: () => Promise<Page>
): Promise<{ readonly page: Page; readonly frame: Frame; readonly callId: string }> => {
  const callIndex = session.agents.toolCalls.length
  let page = await open()
  let previous = page.frames()
  const allow = () => page.locator(".monaco-button:visible", { hasText: "Allow in this Session" })
  const missing = () => page.getByText(/^NO_ASK_FORM/)
  const called = () => session.agents.toolCalls.length > callIndex
  for (let attempt = 0; attempt < 5 && !(await allow().isVisible()) && !called(); attempt++) {
    if (attempt > 0 && (await missing().count()) > 0) {
      page = await open()
      previous = page.frames()
    }
    const before = await missing().count()
    await sleep(attempt * 5000)
    await send(page)
    await until(
      async () => ((await allow().isVisible()) || called() || (await missing().count()) > before ? true : undefined),
      `${harness} asks for permission, calls ask_form, or answers without ask_form`,
      120_000
    )
  }
  const call = await until(() => Promise.resolve(session.agents.toolCalls[callIndex]), `${harness} calls ask_form`, 120_000)
  let shown = false
  const approved = until(
    async () => {
      if (!shown && (await allow().isVisible())) {
        await allow()
          .click({ timeout: 5000 })
          .catch(() => null)
      }
      return shown ? true : undefined
    },
    `${harness} runs ask_form`,
    150_000
  )
  const frame = await formFrame(page, previous).finally(() => {
    shown = true
  })
  await approved
  return { page, frame, callId: call.id }
}

const resultOf = (session: Session, callId: string) =>
  until(
    () => Promise.resolve(session.agents.toolResults.find((item) => item.id === callId)),
    `the model receives the answer for ${callId}`,
    60_000
  )

const answer = async (session: Session, page: Page, frame: Frame, callId: string): Promise<void> => {
  await settled(frame)
  const attendees = frame.getByRole("spinbutton", { name: "参加者数" })
  await attendees.fill("150")
  await attendees.press("Tab")
  await frame.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click")
  const result = await resultOf(session, callId)
  expect(result.text).toContain('"status":"submitted"')
  expect(result.text).toContain('"changedByUser":["attendees"]')
  await page.getByText("FAKE_AGENT_DONE", { exact: true }).waitFor({ timeout: 60_000 })
}

const answerDelay = Number(process.env["ASK_FORM_E2E_ANSWER_DELAY_MS"] ?? "0")

const answeredInPanel = (harness: Harness, open: (session: Session) => Promise<Page>) => async (session: Session) => {
  const { page, frame, callId } = await ask(session, harness, () => open(session))
  const statusBar = page === session.window
  if (statusBar) {
    await waiting(page).waitFor({ timeout: 30_000 })
  }
  if (answerDelay > 0) {
    await sleep(answerDelay)
    expect(session.agents.toolResults.some((item) => item.id === callId)).toBe(false)
  }
  await answer(session, page, frame, callId)
  await until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the panel closes", 30_000)
  if (statusBar) {
    await waiting(page).waitFor({ state: "hidden", timeout: 30_000 })
  }
}

const agentsWindow = async (session: Session): Promise<Page> => {
  const existing = session.app.windows().find((page) => page.url().includes("sessions.html"))
  if (existing !== undefined) {
    return existing
  }
  const opened = session.app.waitForEvent("window", { predicate: (page) => page.url().includes("sessions.html"), timeout: 180_000 })
  await runCommand(session.window, "Ask Form: Open acceptance Agents window")
  const page = await opened
  const skip = page.getByText("Continue Without Signing In", { exact: true })
  await skip.waitFor({ timeout: 60_000 })
  await skip.click()
  return page
}

const newAgentsSession = async (page: Page, harness: Harness): Promise<Page> => {
  await page.getByRole("button", { name: /^New/ }).first().click()
  const picker = page.locator(".monaco-action-bar .action-label:visible", { hasText: /^(Copilot|Claude|Codex)$/ }).first()
  await picker.waitFor({ timeout: 60_000 })
  if ((await picker.innerText()).trim() !== harness) {
    await picker.click()
    await page
      .locator(".monaco-list-row:visible", { hasText: new RegExp(`^\\s*${harness}\\s*$`) })
      .first()
      .click()
  }
  await modelReady(page, harness)
  return page
}

const inAgentsWindow = (harness: Harness) => async (session: Session) => newAgentsSession(await agentsWindow(session), harness)

test(
  "REQ-ASK-001 既定のCopilotハーネスでは、フォームがチャットの横のパネルに出て、回答がモデルに届く",
  answeredInPanel("Copilot", (session) => openSession(session, "Copilot"))
)

test(
  "REQ-ENV-002 Codexのハーネスでも、フォームがチャットの横のパネルに出て、回答がモデルに届く",
  answeredInPanel("Codex", (session) => openSession(session, "Codex"))
)

test(
  "REQ-ENV-003 AgentsウィンドウのCopilotハーネスでも、フォームがパネルに出て、回答がモデルに届く",
  answeredInPanel("Copilot", inAgentsWindow("Copilot"))
)

test(
  "REQ-ENV-003 AgentsウィンドウのCodexハーネスでも、既定のモデルがコードモードでツールを呼んで、フォームがパネルに出て回答が届く",
  answeredInPanel("Codex", inAgentsWindow("Codex"))
)

const agentHostLog = async (profile: string): Promise<string> => {
  const logs = join(profile, "user", "logs")
  const sessions = await readdir(logs).catch(() => [])
  const latest = sessions.toSorted().at(-1)
  const text = latest === undefined ? "" : await readFile(join(logs, latest, "agenthost.log"), "utf8").catch(() => "")
  return text
    .split("\n")
    .filter((line) => /\[(Codex|Claude)\]|error/i.test(line))
    .slice(-40)
    .join("\n")
}

const report = async (paths: Paths, session: Session, profile: string): Promise<void> => {
  const { app, agents } = session
  for (const [index, page] of app.windows().entries()) {
    await page.screenshot({ path: join(paths.results, `agents-failure-${index}.png`), timeout: 10_000 }).catch(() => null)
  }
  await writeFile(
    join(paths.results, "agents-llm.json"),
    JSON.stringify({ toolCalls: agents.toolCalls, toolResults: agents.toolResults, toolNames: agents.toolNames }, undefined, 2)
  )
  for (const page of app.windows()) {
    await printChat(page)
  }
  console.error(`fake agents: ${agents.toolNames.length} request(s), ask_form calls ${JSON.stringify(agents.toolCalls)}`)
  for (const names of agents.toolNames) {
    console.error(`  tools(${names.length}): ${names.filter((name) => /ask|search|user_input/i.test(name)).join(",")}`)
  }
  console.error(`agent host log:\n${await agentHostLog(profile)}`)
}

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
        "chat.agentHost.codexAgent.enabled": true,
        "chat.editor.codex.preferAgentHost": true
      },
      env: {
        HOME: home,
        CODEX_HOME: join(profile, "codex"),
        ASK_FORM_E2E_BYOK_URL: `${agents.origin}/v1/chat/completions`,
        ...(process.getuid?.() === 0 ? { IS_SANDBOX: "1" } : {}),
        ...(process.env["ASK_FORM_OPENSSL_LIB"] === undefined ? {} : { LD_LIBRARY_PATH: process.env["ASK_FORM_OPENSSL_LIB"] })
      }
    })
    const window = await fitWindow(app, { width: 1600, height: 1000 })
    window.context().setDefaultTimeout(30_000)
    const session: Session = { app, window, agents }
    await run(session, () => report(paths, session, profile))
  } finally {
    await cleanUp(app, agents, profile)
  }
}
