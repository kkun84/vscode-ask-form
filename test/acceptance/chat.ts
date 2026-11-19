import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, type ElectronApplication, type Frame, type Locator, type Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeLlm, type FakeLlm } from "./fake-llm.ts"
import { formFrame, settled, until } from "./frames.ts"
import { cleanUp, fitWindow, launchVscode, localHarness, type VscodePaths } from "./vscode.ts"

interface Paths extends VscodePaths {
  readonly results: string
}

const trigger = "ASK_FORM_E2E"

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

const runCommand = async (session: Session, title: string): Promise<void> => {
  await session.window.keyboard.press("F1")
  await session.window.locator(".quick-input-widget input").fill(`>${title}`)
  await session.window.locator(".quick-input-list .monaco-list-row", { hasText: title }).click()
}

const newForm = async (session: Session): Promise<void> => {
  const previous = session.window.frames()
  const callIndex = session.llm.toolCalls.length
  await runCommand(session, "Ask Form: New acceptance chat")
  await receiveForm(session, callIndex, previous)
}

const setAttendees = async (session: Session, value: string): Promise<void> => {
  const input = theFrame(session).getByRole("spinbutton", { name: "参加者数" })
  await input.fill(value)
  await input.press("Tab")
}

const closed = (frame: Frame) => until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the form panel closes", 30_000)

const answer = async (session: Session, button = "Send"): Promise<string> => {
  const frame = theFrame(session)
  await settled(frame)
  await frame.getByRole("button", { name: button, exact: true }).dispatchEvent("click")
  const result = await until(
    () => Promise.resolve(session.llm.toolResults.find((item) => item.callId === session.callId)),
    `the model receives the answer for ${session.callId}`,
    60_000
  )
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
  await closed(frame)
  await session.window.getByText("FAKE_LLM_DONE", { exact: true }).waitFor({ timeout: 30_000 })
  await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
  return result.text
}

const askedSpec = { ...eventSpec, description: `${eventSpec.description}${"The form explains itself at length. ".repeat(9)}` }

test("REQ-ASK-001 Copilotのチャットで、AIが目安の文字数を超えた設計図でもパネルのフォームで質問できる", async (session) => {
  await receiveForm(session, 0)
})

test("REQ-ASK-002 フォームにAIの推奨と理由が表示される", async (session) => {
  const frame = theFrame(session)
  check((await frame.getByRole("textbox", { name: "イベント名" }).inputValue()) === "技術交流会 2026", "the recommended value is filled in")
  await frame.getByText("README.mdより").waitFor({ timeout: 10_000 })
  await frame.getByText(askedSpec.description).waitFor({ timeout: 10_000 })
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

test("REQ-RES-001 回答するとフォームのパネルが閉じる", async (session) => {
  await closed(theFrame(session))
})

const pressKey = async (button: Locator): Promise<void> => {
  await button.focus()
  await button.press("Enter")
}

const settledForm = async (session: Session) => {
  await newForm(session)
  const frame = theFrame(session)
  await settled(frame)
  return frame
}

test("REQ-ANS-005 値を外してコメントを書いた質問は、値なしでheldとheldFormとしてモデルに届く", async (session) => {
  const frame = await settledForm(session)
  const price = frame.getByRole("spinbutton", { name: "参加費" })
  await price.fill("")
  await price.press("Tab")
  await pressKey(frame.getByRole("button", { name: "Comment on 参加費" }))
  await pressKey(frame.getByRole("group", { name: "Preset comments for 参加費" }).getByRole("button", { name: "他の要件を先に決める。" }))
  const result = await answer(session)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"held":["price"]')
  expect(result).toContain('"heldForm":{')
  expect(result).toContain('"comments":{"price":"他の要件を先に決める。"}')
  expect(result).not.toContain('"price":2')
})

test("REQ-ANS-007 質問へのコメントは、commentsとしてモデルに届く", async (session) => {
  const frame = await settledForm(session)
  await pressKey(frame.getByRole("button", { name: "Comment on 参加費" }))
  await frame.getByRole("textbox", { name: "Comment on 参加費" }).fill("Keep it under 3000.")
  const result = await answer(session)
  expect(result).toContain('"comments":{"price":"Keep it under 3000."}')
})

test("REQ-ANS-006 補足を書いて送信すると、noteとしてモデルに届く", async (session) => {
  await settledForm(session)
  const frame = theFrame(session)
  await frame.locator("details.note summary").click()
  await frame.getByRole("textbox", { name: "Add a note" }).fill("The venue is not decided yet.")
  const result = await answer(session)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"note":"The venue is not decided yet."')
  expect(result).toContain("If note is present")
})

test("REQ-ANS-003 キャンセルすると、answer_in_chatがモデルに届く", async (session) => {
  await newForm(session)
  const result = await answer(session, "Cancel")
  expect(result).toContain('"status":"answer_in_chat"')
  expect(result).toContain("End your turn now and wait for the user's next message")
})

test("REQ-CANCEL-001 待機中にチャットを停止すると、フォームのパネルが閉じ、ステータスバーの表示が消える", async (session) => {
  await newForm(session)
  await waiting(session).waitFor({ timeout: 30_000 })
  await stopButton(session).click()
  await closed(theFrame(session))
  await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
  await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
})

test("REQ-WAIT-002 質問に自動で応じる設定では、フォームは待たずにunavailableをモデルに返す", async (session) => {
  await runCommand(session, "Ask Form: Toggle acceptance auto reply")
  try {
    const callIndex = session.llm.toolCalls.length
    await runCommand(session, "Ask Form: New acceptance chat")
    const call = await until(() => Promise.resolve(session.llm.toolCalls[callIndex]), "the model asks with a form", 120_000)
    const result = await until(
      () => Promise.resolve(session.llm.toolResults.find((item) => item.callId === call.id)),
      "the model receives the result without an answer",
      60_000
    )
    expect(result.text).toContain('"status":"unavailable"')
    expect(result.text).toContain("Do not ask these questions again")
    await session.window.getByText("FAKE_LLM_DONE", { exact: true }).waitFor({ timeout: 30_000 })
    await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
    await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
  } finally {
    await runCommand(session, "Ask Form: Toggle acceptance auto reply")
  }
})

test("REQ-WAIT-002 フォームが待っている間に設定を有効にすると、待つのをやめてunavailableをモデルに返す", async (session) => {
  await newForm(session)
  await waiting(session).waitFor({ timeout: 30_000 })
  await runCommand(session, "Ask Form: Toggle acceptance auto reply")
  try {
    const result = await until(
      () => Promise.resolve(session.llm.toolResults.find((item) => item.callId === session.callId)),
      "the model receives the result without an answer",
      60_000
    )
    expect(result.text).toContain('"status":"unavailable"')
    await waiting(session).waitFor({ state: "hidden", timeout: 30_000 })
    await closed(theFrame(session))
    await stopButton(session).waitFor({ state: "hidden", timeout: 30_000 })
  } finally {
    await runCommand(session, "Ask Form: Toggle acceptance auto reply")
  }
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

export const runChat = async (paths: Paths): Promise<void> => {
  await mkdir(paths.results, { recursive: true })
  const log = join(paths.results, "driver.log")
  await rm(log, { force: true })
  const llm = await startFakeLlm(trigger, askedSpec)
  const profile = await mkdtemp(join(tmpdir(), "ask-form-chat-"))
  let app: ElectronApplication | undefined
  try {
    app = await launchVscode(paths, {
      llm,
      log,
      profile,
      locale: "en",
      query: `${trigger} Please ask me with a form.`,
      settings: localHarness
    })
    const window = await fitWindow(app, { width: 1600, height: 1000 })
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
    await cleanUp(app, llm, profile)
  }
}
