import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import { runCommand } from "./commands.ts"
import { attachDiagnostics, test } from "./fixtures.ts"
import { closedDuringClick, formFrame, settled, until } from "./frames.ts"
import { askedSpec, type Session } from "./session.ts"

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

const startChat = async (session: Session): Promise<string> => {
  const callIndex = session.llm.toolCalls.length
  await runCommand(session.window, "Ask User Form: New acceptance chat", false)
  const call = await until(() => Promise.resolve(session.llm.toolCalls[callIndex]), "the model asks with a form", 120_000)
  return call.id
}

const newForm = async (session: Session): Promise<Asked> => {
  const previous = session.window.frames()
  const callId = await startChat(session)
  return { frame: await formFrame(session.window, previous), callId }
}

const settledForm = async (session: Session): Promise<Asked> => {
  const asked = await newForm(session)
  await settled(asked.frame)
  return asked
}

const closed = (frame: Frame) => until(() => Promise.resolve(frame.isDetached() ? true : undefined), "the form panel closes", 30_000)

const resultOf = (session: Session, callId: string, message: string) =>
  until(() => Promise.resolve(session.llm.toolResults.find((item) => item.id === callId)), message, 60_000)

const answer = async (session: Session, asked: Asked, button = "Send"): Promise<string> => {
  await settled(asked.frame)
  await asked.frame.getByRole("button", { name: button, exact: true }).dispatchEvent("click").catch(closedDuringClick)
  const result = await resultOf(session, asked.callId, `the model receives the answer for ${asked.callId}`)
  await closed(asked.frame)
  await session.window.getByText("STUB_MODEL_DONE", { exact: true }).last().waitFor({ timeout: 30_000 })
  await idle(session.window)
  return result.text
}

const pressKey = async (button: Locator): Promise<void> => {
  await button.focus()
  await button.press("Enter")
}

const toggleAutoReply = (session: Session) => runCommand(session.window, "Ask User Form: Toggle acceptance auto reply", false)

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

test.afterEach(async ({ session }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await attachDiagnostics(session, testInfo)
  }
  for (const frame of await openForms(session.window)) {
    await frame.locator("form.card button.ghost").dispatchEvent("click").catch(closedDuringClick)
    await closed(frame)
  }
  await idle(session.window)
})

test("REQ-ASK-001 Copilotのチャットで、AIが目安の文字数を超えた設計図でもパネルのフォームで質問できる", async ({ session }) => {
  const { frame } = await newForm(session)
  await expect(frame.locator("form.card button.primary")).toBeVisible()
})

test("REQ-ASK-002 フォームにAIの推奨と理由が表示される", async ({ session }) => {
  const { frame } = await newForm(session)
  await expect(frame.getByRole("textbox", { name: "イベント名" })).toHaveValue("技術交流会 2026")
  await frame.getByText("README.mdより").waitFor({ timeout: 10_000 })
  await frame.getByText(askedSpec.description).waitFor({ timeout: 10_000 })
})

test("REQ-WAIT-001 回答を待つ間、ステータスバーに表示される", async ({ session }) => {
  await newForm(session)
  await waiting(session.window).waitFor({ timeout: 30_000 })
})

test("REQ-ANS-001 フォームで回答すると、同じ流れのままモデルに回答が届く", async ({ session }) => {
  const asked = await settledForm(session)
  const attendees = asked.frame.getByRole("spinbutton", { name: "参加者数" })
  await attendees.fill("150")
  await attendees.press("Tab")
  const result = await answer(session, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"changedByUser":["attendees"]')
})

test("REQ-RES-001 回答するとフォームのパネルが閉じる", async ({ session }) => {
  const asked = await settledForm(session)
  await asked.frame.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click").catch(closedDuringClick)
  await closed(asked.frame)
})

test("REQ-ANS-005 値を外してコメントを書いた質問は、値なしでheldとheldFormとしてモデルに届く", async ({ session }) => {
  const asked = await settledForm(session)
  const { frame } = asked
  const price = frame.getByRole("spinbutton", { name: "参加費" })
  await price.fill("")
  await price.press("Tab")
  await pressKey(frame.getByRole("button", { name: "Comment on 参加費" }))
  await pressKey(frame.getByRole("group", { name: "Preset comments for 参加費" }).getByRole("button", { name: "他の要件を先に決める。" }))
  const result = await answer(session, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"held":["price"]')
  expect(result).toContain('"heldForm":{')
  expect(result).toContain('"comments":{"price":"他の要件を先に決める。"}')
  expect(result).not.toContain('"price":2')
})

test("REQ-ANS-007 質問へのコメントは、commentsとしてモデルに届く", async ({ session }) => {
  const asked = await settledForm(session)
  await pressKey(asked.frame.getByRole("button", { name: "Comment on 参加費" }))
  await asked.frame.getByRole("textbox", { name: "Comment on 参加費" }).fill("Keep it under 3000.")
  const result = await answer(session, asked)
  expect(result).toContain('"comments":{"price":"Keep it under 3000."}')
})

test("REQ-ANS-006 補足を書いて送信すると、noteとしてモデルに届く", async ({ session }) => {
  const asked = await settledForm(session)
  await asked.frame.getByRole("button", { name: "Add a note" }).click()
  await asked.frame.getByRole("textbox", { name: "Add a note" }).fill("The venue is not decided yet.")
  const result = await answer(session, asked)
  expect(result).toContain('"status":"submitted"')
  expect(result).toContain('"note":"The venue is not decided yet."')
  expect(result).toContain("If note is present")
})

test("REQ-ANS-003 キャンセルすると、answer_in_chatがモデルに届く", async ({ session }) => {
  const asked = await newForm(session)
  const result = await answer(session, asked, "Cancel")
  expect(result).toContain('"status":"answer_in_chat"')
  expect(result).toContain("End your turn now and wait for the user's next message")
})

test("REQ-CANCEL-001 待機中にチャットを停止すると、フォームのパネルが閉じ、ステータスバーの表示が消える", async ({ session }) => {
  const { frame } = await newForm(session)
  await waiting(session.window).waitFor({ timeout: 30_000 })
  await stopButton(session.window).click()
  await closed(frame)
  await idle(session.window)
})

test("REQ-WAIT-002 質問に自動で応じる設定では、フォームは待たずにunavailableをモデルに返す", async ({ session }) => {
  await toggleAutoReply(session)
  try {
    const callId = await startChat(session)
    const result = await resultOf(session, callId, "the model receives the result without an answer")
    expect(result.text).toContain('"status":"unavailable"')
    expect(result.text).toContain("Do not ask these questions again")
    await session.window.getByText("STUB_MODEL_DONE", { exact: true }).last().waitFor({ timeout: 30_000 })
    await idle(session.window)
  } finally {
    await toggleAutoReply(session)
  }
})

test("REQ-WAIT-002 フォームが待っている間に設定を有効にすると、待つのをやめてunavailableをモデルに返す", async ({ session }) => {
  const asked = await newForm(session)
  await waiting(session.window).waitFor({ timeout: 30_000 })
  await toggleAutoReply(session)
  try {
    const result = await resultOf(session, asked.callId, "the model receives the result without an answer")
    expect(result.text).toContain('"status":"unavailable"')
    await closed(asked.frame)
    await idle(session.window)
  } finally {
    await toggleAutoReply(session)
  }
})
