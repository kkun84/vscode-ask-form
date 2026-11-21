import { readFile } from "node:fs/promises"
import { expect, type Frame, type Locator, type Page, type TestInfo } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { runCommand } from "./commands.ts"
import { test as base } from "./fixtures.ts"
import { closedDuringClick, formFrame, settled, until } from "./frames.ts"
import { openChatSession, type ChatSession } from "./session.ts"

const askedSpec = { ...eventSpec, description: `${eventSpec.description}${"The form explains itself at length. ".repeat(9)}` }

const test = base.extend<object, { readonly chat: ChatSession }>({
  chat: [
    async ({ platform }, use, workerInfo) => {
      const session = await openChatSession(platform, askedSpec, workerInfo.project.outputDir)
      await use(session)
      await session.close()
    },
    { scope: "worker", timeout: 600_000 }
  ]
})

interface Asked {
  readonly frame: Frame
  readonly callId: string
}

const waiting = (window: Page) => window.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

const stopButton = (window: Page) => window.locator(".interactive-input-part .codicon-stop-circle")

const idle = async (window: Page): Promise<void> => {
  await waiting(window).waitFor({ state: "hidden", timeout: 30_000 })
  await stopButton(window).waitFor({ state: "hidden", timeout: 30_000 })
}

const startChat = async (chat: ChatSession): Promise<string> => {
  const callIndex = chat.llm.toolCalls.length
  await runCommand(chat.window, "Ask Form: New acceptance chat", false)
  const call = await until(() => Promise.resolve(chat.llm.toolCalls[callIndex]), "the model asks with a form", 120_000)
  return call.id
}

const newForm = async (chat: ChatSession): Promise<Asked> => {
  const previous = chat.window.frames()
  const callId = await startChat(chat)
  return { frame: await formFrame(chat.window, previous), callId }
}

const settledForm = async (chat: ChatSession): Promise<Asked> => {
  const asked = await newForm(chat)
  await settled(asked.frame)
  return asked
}

const closed = (frame: Frame) => until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the form panel closes", 30_000)

const resultOf = (chat: ChatSession, callId: string, message: string) =>
  until(() => Promise.resolve(chat.llm.toolResults.find((item) => item.id === callId)), message, 60_000)

const answer = async (chat: ChatSession, asked: Asked, button = "Send"): Promise<string> => {
  await settled(asked.frame)
  await asked.frame.getByRole("button", { name: button, exact: true }).dispatchEvent("click").catch(closedDuringClick)
  const result = await resultOf(chat, asked.callId, `the model receives the answer for ${asked.callId}`)
  await closed(asked.frame)
  await chat.window.getByText("STUB_MODEL_DONE", { exact: true }).last().waitFor({ timeout: 30_000 })
  await idle(chat.window)
  return result.text
}

const pressKey = async (button: Locator): Promise<void> => {
  await button.focus()
  await button.press("Enter")
}

const toggleAutoReply = (chat: ChatSession) => runCommand(chat.window, "Ask Form: Toggle acceptance auto reply", false)

const openForms = async (window: Page): Promise<ReadonlyArray<Frame>> => {
  const found: Array<Frame> = []
  for (const frame of window.frames()) {
    const count = await frame
      .locator("form.card button.ghost")
      .count()
      .catch(() => 0)
    if (count > 0) {
      found.push(frame)
    }
  }
  return found
}

const attachDiagnostics = async (chat: ChatSession, testInfo: TestInfo): Promise<void> => {
  const screenshot = await chat.window.screenshot({ timeout: 10_000 }).catch(() => null)
  if (screenshot !== null) {
    await testInfo.attach("window", { body: screenshot, contentType: "image/png" })
  }
  const text = await chat.window
    .locator(".interactive-session")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "(no chat text)")
  await testInfo.attach("chat", { body: text, contentType: "text/plain" })
  await testInfo.attach("driver-log", { body: await readFile(chat.log, "utf8").catch(() => "(no driver log)"), contentType: "text/plain" })
  await testInfo.attach("stub-model", {
    body: JSON.stringify({ toolCalls: chat.llm.toolCalls, toolResults: chat.llm.toolResults, toolNames: chat.llm.toolNames }, undefined, 2),
    contentType: "application/json"
  })
}

test.afterEach(async ({ chat }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await attachDiagnostics(chat, testInfo)
  }
  for (const frame of await openForms(chat.window)) {
    await frame.locator("form.card button.ghost").dispatchEvent("click").catch(closedDuringClick)
    await closed(frame)
  }
  await idle(chat.window)
})

test("REQ-ASK-001 Copilotのチャットで、AIが目安の文字数を超えた設計図でもパネルのフォームで質問できる", async ({ chat }) => {
  const { frame } = await newForm(chat)
  await expect(frame.locator("form.card button.primary")).toBeVisible()
})

test("REQ-ASK-002 フォームにAIの推奨と理由が表示される", async ({ chat }) => {
  const { frame } = await newForm(chat)
  await expect(frame.getByRole("textbox", { name: "イベント名" })).toHaveValue("技術交流会 2026")
  await frame.getByText("README.mdより").waitFor({ timeout: 10_000 })
  await frame.getByText(askedSpec.description).waitFor({ timeout: 10_000 })
})

test("REQ-WAIT-001 回答を待つ間、ステータスバーに表示される", async ({ chat }) => {
  await newForm(chat)
  await waiting(chat.window).waitFor({ timeout: 30_000 })
})

test("REQ-ANS-001 フォームで回答すると、同じ流れのままモデルに回答が届く", async ({ chat }) => {
  const asked = await settledForm(chat)
  const attendees = asked.frame.getByRole("spinbutton", { name: "参加者数" })
  await attendees.fill("150")
  await attendees.press("Tab")
  const result = await answer(chat, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"changedByUser":["attendees"]')
})

test("REQ-RES-001 回答するとフォームのパネルが閉じる", async ({ chat }) => {
  const asked = await settledForm(chat)
  await asked.frame.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click").catch(closedDuringClick)
  await closed(asked.frame)
})

test("REQ-ANS-005 値を外してコメントを書いた質問は、値なしでheldとheldFormとしてモデルに届く", async ({ chat }) => {
  const asked = await settledForm(chat)
  const { frame } = asked
  const price = frame.getByRole("spinbutton", { name: "参加費" })
  await price.fill("")
  await price.press("Tab")
  await pressKey(frame.getByRole("button", { name: "Comment on 参加費" }))
  await pressKey(frame.getByRole("group", { name: "Preset comments for 参加費" }).getByRole("button", { name: "他の要件を先に決める。" }))
  const result = await answer(chat, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"held":["price"]')
  expect(result).toContain('"heldForm":{')
  expect(result).toContain('"comments":{"price":"他の要件を先に決める。"}')
  expect(result).not.toContain('"price":2')
})

test("REQ-ANS-007 質問へのコメントは、commentsとしてモデルに届く", async ({ chat }) => {
  const asked = await settledForm(chat)
  await pressKey(asked.frame.getByRole("button", { name: "Comment on 参加費" }))
  await asked.frame.getByRole("textbox", { name: "Comment on 参加費" }).fill("Keep it under 3000.")
  const result = await answer(chat, asked)
  expect(result).toContain('"comments":{"price":"Keep it under 3000."}')
})

test("REQ-ANS-006 補足を書いて送信すると、noteとしてモデルに届く", async ({ chat }) => {
  const asked = await settledForm(chat)
  await asked.frame.locator("details.note summary").click()
  await asked.frame.getByRole("textbox", { name: "Add a note" }).fill("The venue is not decided yet.")
  const result = await answer(chat, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"note":"The venue is not decided yet."')
  expect(result).toContain("If note is present")
})

test("REQ-ANS-003 キャンセルすると、answer_in_chatがモデルに届く", async ({ chat }) => {
  const asked = await newForm(chat)
  const result = await answer(chat, asked, "Cancel")
  expect(result).toContain('"status":"answer_in_chat"')
  expect(result).toContain("End your turn now and wait for the user's next message")
})

test("REQ-CANCEL-001 待機中にチャットを停止すると、フォームのパネルが閉じ、ステータスバーの表示が消える", async ({ chat }) => {
  const { frame } = await newForm(chat)
  await waiting(chat.window).waitFor({ timeout: 30_000 })
  await stopButton(chat.window).click()
  await closed(frame)
  await idle(chat.window)
})

test("REQ-WAIT-002 質問に自動で応じる設定では、フォームは待たずにunavailableをモデルに返す", async ({ chat }) => {
  await toggleAutoReply(chat)
  try {
    const callId = await startChat(chat)
    const result = await resultOf(chat, callId, "the model receives the result without an answer")
    expect(result.text).toContain('"status":"unavailable"')
    expect(result.text).toContain("Do not ask these questions again")
    await chat.window.getByText("STUB_MODEL_DONE", { exact: true }).last().waitFor({ timeout: 30_000 })
    await idle(chat.window)
  } finally {
    await toggleAutoReply(chat)
  }
})

test("REQ-WAIT-002 フォームが待っている間に設定を有効にすると、待つのをやめてunavailableをモデルに返す", async ({ chat }) => {
  const asked = await newForm(chat)
  await waiting(chat.window).waitFor({ timeout: 30_000 })
  await toggleAutoReply(chat)
  try {
    const result = await resultOf(chat, asked.callId, "the model receives the result without an answer")
    expect(result.text).toContain('"status":"unavailable"')
    await closed(asked.frame)
    await idle(chat.window)
  } finally {
    await toggleAutoReply(chat)
  }
})
