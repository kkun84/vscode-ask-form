import { expect, type Frame } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { runCommand } from "./commands.ts"
import { attachDiagnostics, test } from "./fixtures.ts"
import { closedDuringClick, formFrame, until } from "./frames.ts"
import type { Session } from "./session.ts"

const invoke = async (session: Session): Promise<{ readonly frame: Frame; readonly result: () => Promise<string> }> => {
  const previous = session.window.frames()
  const index = (await session.events()).filter((line) => / invoked \d+$/.test(` ${line}`)).length + 1
  await runCommand(session.window, "Ask Form: Invoke acceptance form")
  const frame = await formFrame(session.window, previous)
  const marker = `result ${index} `
  return {
    frame,
    result: () =>
      until(
        async () => {
          const line = (await session.events()).find((entry) => entry.includes(marker))
          return line === undefined ? null : (JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as string)
        },
        `the tool call ${index} settles`,
        60_000
      )
  }
}

const closed = (frame: Frame) => expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true)

test.afterEach(async ({ session }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await attachDiagnostics(session, testInfo)
  }
  await runCommand(session.window, "Ask Form: Cancel acceptance form")
})

test("REQ-WEB-001 デスクトップ版でもweb版でも、ハーネスを通さずにツールが呼ばれると、フォームを横のパネルに表示し、そこで回答するとツールの結果になる", async ({
  session
}) => {
  const { frame, result } = await invoke(session)
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
  const { frame, result } = await invoke(session)
  await runCommand(session.window, "Ask Form: Cancel acceptance form", false)
  await closed(frame)
  expect(await result()).toMatch(/"status":"answer_in_chat"|Canceled/)
})

test("REQ-WAIT-001 フォームが別のタブに隠れても、待機の表示から前面に出せ、キャンセルを押すとパネルが閉じる", async ({ session }) => {
  const { frame, result } = await invoke(session)
  const tab = session.window.locator(".tabs-container .tab", { hasText: eventSpec.title })
  await expect(tab).toHaveClass(/\bactive\b/)
  await runCommand(session.window, "File: New Untitled Text File", false)
  await expect(tab).not.toHaveClass(/\bactive\b/)
  await session.window.locator(".statusbar-item", { hasText: /回答を待っています|waiting for your answer/ }).click()
  await expect(tab).toHaveClass(/\bactive\b/)
  await frame.locator("form.card button.ghost").dispatchEvent("click").catch(closedDuringClick)
  await closed(frame)
  expect(await result()).toContain('"status":"answer_in_chat"')
})
