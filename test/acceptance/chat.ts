import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { join } from "node:path"
import { _electron as electron, expect, type ElectronApplication, type Frame, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts"
import { formFrame, sleep, until } from "./frames.ts"

interface Paths {
  readonly executable: string
  readonly extension: string
  readonly driver: string
  readonly results: string
}

const trigger = "ASK_FORM_E2E"

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
  callId: string | undefined
}

const steps: Array<{ readonly name: string; readonly body: Step }> = []

const test = (name: string, body: Step): void => {
  steps.push({ name, body })
}

const waiting = (session: Session) => session.window.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

const stopButton = (session: Session) => session.window.locator(".interactive-input-part .codicon-stop-circle")

const theFrame = (session: Session): Frame => {
  if (session.frame === undefined) {
    throw new Error("the form has not appeared")
  }
  return session.frame
}

const receiveForm = async (session: Session, callIndex: number, previous: ReadonlyArray<Frame> = []): Promise<void> => {
  session.frame = undefined
  const call = await until(() => Promise.resolve(session.llm.toolCalls[callIndex]), "the model asks for a fresh form", 120_000)
  session.callId = call.id
  session.frame = await formFrame(session.window, previous)
}

const newForm = async (session: Session): Promise<void> => {
  const previous = session.window.frames()
  const callIndex = session.llm.toolCalls.length
  await session.window.keyboard.press("F1")
  await session.window.locator(".quick-input-widget input").fill(">Ask Form: New acceptance chat")
  await session.window.locator(".quick-input-list .monaco-list-row", { hasText: "Ask Form: New acceptance chat" }).click()
  await receiveForm(session, callIndex, previous)
}

const setAttendees = async (session: Session, value: string): Promise<void> => {
  const input = theFrame(session).getByRole("spinbutton", { name: "参加者数" })
  await input.fill(value)
  await input.press("Tab")
}

const answer = async (session: Session, button = "Continue with this"): Promise<string> => {
  const frame = theFrame(session)
  await frame.getByRole("button", { name: button, exact: true }).click()
  const result = await until(
    () => Promise.resolve(session.llm.toolResults.find((item) => item.callId === session.callId)),
    `the model receives the answer for ${session.callId}`,
    60_000
  )
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
  await frame.locator(".summary").waitFor({ timeout: 30_000 })
  await session.window.getByText("FAKE_LLM_DONE", { exact: true }).waitFor({ timeout: 30_000 })
  await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
  return result.text
}

const editAnswer = async (session: Session): Promise<void> => {
  await newForm(session)
  await setAttendees(session, "150")
  const result = await answer(session)
  check(result.includes('"status":"submitted"'), `the initial answer is submitted: ${result}`)
  await theFrame(session).getByRole("button", { name: "Edit and resend", exact: true }).click()
}

const guesses = Object.fromEntries(eventSpec.fields.map((field) => [field.id, field.default]))

test("REQ-ASK-001 Copilotのチャットで、AIがフォームで質問できる", async (session) => {
  await receiveForm(session, 0)
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
  await setAttendees(session, "150")
  const result = await answer(session)
  check(result.includes('"status":"submitted"'), `the tool result is submitted: ${result}`)
  check(result.includes('"changedByUser":["attendees"]'), `the tool result marks the changed field: ${result}`)
})

test("REQ-RES-001 回答後のフォームは要約になる", async (session) => {
  await theFrame(session).locator(".summary").waitFor({ timeout: 30_000 })
})

test("REQ-ANS-002 AIに任せると、推測値がdelegatedとしてモデルに届く", async (session) => {
  await newForm(session)
  await setAttendees(session, "180")
  const result = await answer(session, "Let AI decide")
  expect(result).toContain('"status":"delegated"')
  expect(result).toContain(`"values":${JSON.stringify(guesses)}`)
  expect(result).toContain('"computed":{"cost":170000,"profit":70000,"breakEven":85}')
})

test("REQ-ANS-003 チャットで答えると、answer_in_chatがモデルに届く", async (session) => {
  await newForm(session)
  const result = await answer(session, "Answer in chat")
  expect(result).toContain('"status":"answer_in_chat"')
  expect(result).toContain("End your turn now and wait for the user's next message")
})

test("REQ-RES-002 変更を入力欄に置き、利用者が送信すると差分の発言とJSON添付がモデルに届く", async (session) => {
  await editAnswer(session)
  const frame = theFrame(session)
  const price = frame.getByRole("spinbutton", { name: "参加費" })
  await price.fill("2500")
  await price.press("Tab")
  const messageIndex = session.llm.userMessages.length
  await frame.getByRole("button", { name: "Send changes", exact: true }).click()
  await expect(frame.locator(".summary .notice")).toHaveText("Placed in the chat input. Review it before sending.")
  expect(session.llm.userMessages).toHaveLength(messageIndex)
  await session.window.locator(".interactive-input-part .monaco-editor .view-lines").last().click()
  await session.window.keyboard.press("End")
  await session.window.keyboard.press("Enter")
  const difference = `In "${eventSpec.title}", I changed 参加費 to ¥2,500. Please apply it and continue.`
  const posted = session.window.locator(".interactive-request", { hasText: difference })
  await expect(posted).toBeVisible({ timeout: 30_000 })
  await expect(posted.getByText(`${eventSpec.title}.json`, { exact: true })).toBeVisible()
  const received = await until(
    () => Promise.resolve(session.llm.userMessages.slice(messageIndex).find((message) => message.includes(difference))),
    "the model receives the resend as a user message",
    60_000
  )
  expect(received).toContain(`${eventSpec.title}.json`)
  const attachment = received.match(/\{\s*"title":\s*"[^"]+",\s*"values":\s*\{[^}]+\}\s*\}/)?.[0]
  check(attachment !== undefined, `the model receives the JSON attachment contents: ${received}`)
  expect(JSON.parse(attachment ?? "null")).toEqual({ title: eventSpec.title, values: { ...guesses, attendees: 150, price: 2500 } })
  await expect(frame.locator(".summary")).toBeVisible()
  await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
})

test("REQ-RES-003 送り直しで変更がなければ送信ボタンが無効になる", async (session) => {
  await editAnswer(session)
  const frame = theFrame(session)
  const send = frame.getByRole("button", { name: "Send changes", exact: true })
  await expect(send).toBeDisabled()
  await expect(frame.getByText("No changes yet", { exact: true })).toBeVisible()
  await setAttendees(session, "180")
  await expect(send).toBeEnabled()
  await setAttendees(session, "150")
  await expect(send).toBeDisabled()
})

test("REQ-CANCEL-001 待機中にチャットを停止すると、フォームとステータスバーが中断を示す", async (session) => {
  await newForm(session)
  await waiting(session).waitFor({ timeout: 30_000 })
  await stopButton(session).click()
  const frame = theFrame(session)
  await expect(frame.locator("#app > .closed[role='status']")).toHaveText("Cancelled", { timeout: 30_000 })
  await expect(frame.getByRole("button")).toHaveCount(0)
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
  await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
})

const report = async (paths: Paths, session: Session, log: string): Promise<void> => {
  await session.window.screenshot({ path: join(paths.results, "chat-failure.png"), timeout: 10_000 }).catch(() => null)
  console.error(await readFile(log, "utf8").catch(() => "(no driver log)"))
  const chat = await session.window
    .locator(".interactive-session")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "(no chat text)")
  console.error(`chat panel: ${chat.replaceAll(/\s+/g, " ").slice(0, 1500)}`)
  const form = await session.frame
    ?.locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "(no form text)")
  console.error(`form: ${(form ?? "(no frame)").replaceAll(/\s+/g, " ").slice(0, 800)}`)
  console.error(`fake LLM received ${session.llm.requests.length} request(s)`)
  await writeFile(
    join(paths.results, "chat-llm.json"),
    JSON.stringify(
      {
        requests: session.llm.requests,
        toolCalls: session.llm.toolCalls,
        toolResults: session.llm.toolResults,
        userMessages: session.llm.userMessages
      },
      undefined,
      2
    )
  )
  for (const request of session.llm.requests) {
    console.error(
      JSON.stringify({
        tools: (request.tools ?? []).map((tool) => tool.function?.name),
        messages: (request.messages ?? []).map((message) => message.role)
      })
    )
  }
}

const closeApp = async (app: ElectronApplication): Promise<void> => {
  const closed = await Promise.race([
    app
      .close()
      .then(() => true)
      .catch(() => false),
    sleep(10_000).then(() => false)
  ])
  if (!closed) {
    app.process().kill("SIGKILL")
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
    await app.evaluate(({ BrowserWindow }) => {
      for (const browserWindow of BrowserWindow.getAllWindows()) {
        browserWindow.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })
      }
    })
    window.context().setDefaultTimeout(30_000)
    const session: Session = { window, llm, frame: undefined, callId: undefined }
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
    await window.screenshot({ path: join(paths.results, "chat-cancelled.png"), timeout: 10_000 })
  } finally {
    if (app !== undefined) {
      await closeApp(app)
    }
    await llm.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 3 })
  }
}
