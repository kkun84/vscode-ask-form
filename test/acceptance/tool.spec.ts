import { expect } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { runCommand } from "./commands.ts"
import { test } from "./fixtures.ts"
import { closedDuringClick } from "./frames.ts"
import { cancelForm, closed, invokeForm } from "./invoke.ts"
import type { Session } from "./session.ts"

const formTab = (session: Session) => session.window.locator(".tabs-container .tab", { hasText: eventSpec.title })

const waitingItem = (session: Session) =>
  session.window.locator(".statusbar-item", { hasText: /回答を待っています|waiting for your answer/ })

test.afterEach(({ session }, testInfo) => cancelForm(session, testInfo))

test("REQ-WEB-001 デスクトップ版でもweb版でも、ハーネスを通さずにツールが呼ばれると、フォームを横のパネルに表示し、そこで回答するとツールの結果になる", async ({
  session
}) => {
  const { frame, result } = await invokeForm(session)
  await expect(frame.getByRole("textbox", { name: "イベント名" })).toHaveValue("技術交流会 2026")
  await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
  await frame.getByRole("spinbutton", { name: "参加者数" }).press("Tab")
  await frame.locator("form.card button.primary").dispatchEvent("click").catch(closedDuringClick)
  await closed(frame)
  const text = await result()
  expect(text).toContain('"status":"submitted"')
  expect(text).toContain('"changedByUser":["attendees"]')
})

test("REQ-CANCEL-001 ツールの呼び出しが取り消されると、パネルが閉じて待機が終わる", async ({ session }) => {
  const { frame, result } = await invokeForm(session)
  await runCommand(session.window, "Ask Form: Cancel acceptance form", false)
  await closed(frame)
  expect(await result()).toMatch(/"status":"answer_in_chat"|Canceled/)
})

test("REQ-WAIT-001 フォームが別のタブに隠れても、待機の表示から前面に出せ、キャンセルを押すとパネルが閉じる", async ({ session }) => {
  const { frame, result } = await invokeForm(session)
  const tab = formTab(session)
  await expect(tab).toHaveClass(/\bactive\b/)
  await runCommand(session.window, "File: New Untitled Text File", false)
  await expect(tab).not.toHaveClass(/\bactive\b/)
  await waitingItem(session).click()
  await expect(tab).toHaveClass(/\bactive\b/)
  await frame.locator("form.card button.ghost").dispatchEvent("click").catch(closedDuringClick)
  await closed(frame)
  expect(await result()).toContain('"status":"answer_in_chat"')
})

test("REQ-ANS-003 送信せずにパネルのタブを閉じると、キャンセルと同じくチャットで答える結果になり、待機の表示が消える", async ({
  session
}) => {
  const { frame, result } = await invokeForm(session)
  const tab = formTab(session)
  await tab.hover()
  await tab.getByRole("button", { name: /^Close/ }).click()
  await closed(frame)
  expect(await result()).toContain('"status":"answer_in_chat"')
  await expect(waitingItem(session)).toBeHidden()
})
