import { readFile } from "node:fs/promises"
import { expect, type Frame, type Page } from "@playwright/test"
import { agentHostLog, openAgentsSession, type Session } from "./harness-session.ts"
import { runCommand } from "./commands.ts"
import { test as base } from "./fixtures.ts"
import { closedDuringClick, formFrame, settled, sleep, until } from "./frames.ts"
import { trigger } from "./session.ts"

type Harness = "Codex" | "Copilot"

const waiting = (page: Page) => page.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

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
  await frame.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click").catch(closedDuringClick)
  const result = await resultOf(session, callId)
  expect(result.text).toContain('"status":"submitted"')
  expect(result.text).toContain('"changedByUser":["attendees"]')
  await page.getByText("STUB_MODEL_DONE", { exact: true }).waitFor({ timeout: 60_000 })
}

const answerDelay = Number(process.env["ASK_FORM_E2E_ANSWER_DELAY_MS"] ?? "0")

const searchedForTheTool = (requests: ReadonlyArray<ReadonlyArray<string>>): boolean =>
  requests.some((names) => names.includes("tool_search_tool") && !names.some((name) => name.endsWith("askForm")))

const answeredInPanel = (harness: Harness, open: (session: Session) => Promise<Page>) => async (session: Session) => {
  const requests = session.agents.toolNames.length
  const { page, frame, callId } = await ask(session, harness, () => open(session))
  if (harness === "Copilot") {
    expect(searchedForTheTool(session.agents.toolNames.slice(requests))).toBe(true)
  }
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
  const existing = session.windows().find((page) => page.url().includes("sessions.html"))
  if (existing !== undefined) {
    return existing
  }
  if (session.app === undefined) {
    throw new Error("the Agents window needs the desktop app")
  }
  const opened = session.app.waitForEvent("window", { predicate: (page) => page.url().includes("sessions.html"), timeout: 180_000 })
  await runCommand(session.window, "Ask Form: Open acceptance Agents window")
  const page = await opened
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

const test = base.extend<object, { readonly harness: Session }>({
  harness: [
    async ({ platform: _platform }, use, workerInfo) => {
      const session = await openAgentsSession(workerInfo.project.outputDir)
      await use(session)
      await session.close()
    },
    { scope: "worker", timeout: 600_000 }
  ]
})

test.describe.configure({ timeout: 600_000 })

test.afterEach(async ({ harness: session }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    return
  }
  for (const [index, page] of session.windows().entries()) {
    const screenshot = await page.screenshot({ timeout: 10_000 }).catch(() => null)
    if (screenshot !== null) {
      await testInfo.attach(`window-${index}`, { body: screenshot, contentType: "image/png" })
    }
    const chat = await page
      .locator(".interactive-session")
      .first()
      .innerText({ timeout: 5000 })
      .catch(() => "(no chat text)")
    await testInfo.attach(`chat-${index}`, { body: chat, contentType: "text/plain" })
  }
  const { agents } = session
  await testInfo.attach("stub-model", {
    body: JSON.stringify(
      { toolCalls: agents.toolCalls, toolResults: agents.toolResults, toolNames: agents.toolNames, paths: agents.paths },
      undefined,
      2
    ),
    contentType: "application/json"
  })
  await testInfo.attach("driver-log", {
    body: await readFile(session.log, "utf8").catch(() => "(no driver log)"),
    contentType: "text/plain"
  })
  await testInfo.attach("agent-host-log", { body: await agentHostLog(session.profile), contentType: "text/plain" })
})

test("REQ-ASK-001 既定のCopilotハーネスでは、フォームがチャットの横のパネルに出て、回答がモデルに届く", ({ harness }) =>
  answeredInPanel("Copilot", (current) => openSession(current, "Copilot"))(harness))

test("REQ-ENV-002 Codexのハーネスでも、フォームがチャットの横のパネルに出て、回答がモデルに届く", ({ harness }) =>
  answeredInPanel("Codex", (current) => openSession(current, "Codex"))(harness))

test("REQ-ENV-003 AgentsウィンドウのCopilotハーネスでも、フォームがパネルに出て、回答がモデルに届く", ({ harness }) =>
  answeredInPanel("Copilot", inAgentsWindow("Copilot"))(harness))

test("REQ-ENV-003 AgentsウィンドウのCodexハーネスでも、既定のモデルがコードモードでツールを呼んで、フォームがパネルに出て回答が届く", ({
  harness
}) => answeredInPanel("Codex", inAgentsWindow("Codex"))(harness))
