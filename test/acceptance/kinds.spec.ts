import { expect, type Frame, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { closedDuringClick } from "./frames.ts"
import { cancelForm, closed, invokeForm, type Invoked } from "./invoke.ts"
import type { Session } from "./session.ts"

interface Outcome {
  readonly status: string
  readonly values: Readonly<Record<string, unknown>>
  readonly changedByUser: ReadonlyArray<string>
}

const showKinds = (session: Session) => invokeForm(session, "Ask Form: Show every question type")

const outcomeOf = async (invoked: Invoked): Promise<Outcome> => {
  await closed(invoked.frame)
  const text = await invoked.result()
  return JSON.parse(text.slice(text.lastIndexOf("\n") + 1)) as Outcome
}

const send = async (invoked: Invoked): Promise<Outcome> => {
  await invoked.frame.getByRole("button", { name: "Send", exact: true }).dispatchEvent("click").catch(closedDuringClick)
  return outcomeOf(invoked)
}

const placed = (frame: Frame) =>
  frame.getByRole("list", { name: "Ranking for 優先順位" }).getByRole("listitem").locator(".option-head").allTextContents()

const tokens = (frame: Frame) => frame.locator("ui-token-input [data-token-label]").allTextContents()

const press = async (page: Page, ...keys: ReadonlyArray<string>): Promise<void> => {
  for (const key of keys) {
    await page.keyboard.press(key)
  }
}

test.afterEach(({ session }, testInfo) => cancelForm(session, testInfo))

test("REQ-ASK-003 値を変えると、計算結果がすぐ変わる", async ({ session }) => {
  const { frame } = await invokeForm(session)
  const profit = frame.locator(".metric.primary .metric-value")
  await expect(profit).toHaveText("¥70,000")
  const price = frame.getByRole("spinbutton", { name: "参加費" })
  await price.fill("2500")
  await price.press("Tab")
  await expect(profit).toHaveText("¥130,000")
})

test("REQ-ASK-004 選んだ選択肢に関係する質問だけが元の質問のすぐ後ろに出て、その値だけが届く", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  const port = frame.getByRole("spinbutton", { name: "ポート" })
  await expect(port).toBeHidden()
  await frame.getByRole("radio", { name: "サーバー" }).check()
  await expect(port).toBeVisible()
  const labels = await frame.locator(".q:not([hidden]) .q-label").allTextContents()
  expect(labels.slice(0, 2)).toEqual(["保存先", "ポート"])
  await port.fill("8080")
  await port.press("Tab")
  const outcome = await send(invoked)
  expect(outcome.values).toMatchObject({ storage: "server", port: 8080 })
  expect(outcome.changedByUser).toEqual(["storage", "port"])
})

test("REQ-ASK-005 候補を押して順位に入れ、ドラッグとキーボードで並べ替え、×で候補に戻した順が届く", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  await expect.poll(() => placed(frame)).toEqual(["ログイン", "API"])
  await frame.getByRole("listitem", { name: "文書" }).click()
  await expect.poll(() => placed(frame)).toEqual(["ログイン", "API", "文書"])
  await frame.getByRole("listitem", { name: "文書" }).dragTo(frame.getByRole("listitem", { name: "ログイン" }))
  await expect.poll(() => placed(frame)).toEqual(["文書", "ログイン", "API"])
  await frame.getByRole("listitem", { name: "API" }).focus()
  await press(session.window, "Space", "ArrowUp", "Space")
  await expect.poll(() => placed(frame)).toEqual(["文書", "API", "ログイン"])
  await frame.getByRole("button", { name: "Move ログイン back to the candidates" }).click()
  await expect.poll(() => placed(frame)).toEqual(["文書", "API"])
  const outcome = await send(invoked)
  expect(outcome.values["order"]).toEqual(["docs", "api"])
})

test("REQ-ASK-006 文字を打って候補を絞り込んで選び、隠れても選んだものが分かる", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  const filter = frame.getByRole("searchbox", { name: "Filter 言語" })
  await filter.fill("ru")
  await expect(frame.getByRole("group", { name: "言語" }).getByRole("checkbox").filter({ visible: true })).toHaveCount(2)
  await frame.getByRole("checkbox", { name: "Ruby" }).check()
  await filter.fill("zzz")
  await expect(frame.getByText("No matching options")).toBeVisible()
  await expect(frame.getByText(/^Selected: /)).toHaveText(/Ruby/)
  await expect(frame.getByText(/^Selected: /)).toHaveText(/Go/)
  const outcome = await send(invoked)
  expect((outcome.values["langs"] as ReadonlyArray<string>).toSorted()).toEqual(["go", "ruby"])
})

test("REQ-ASK-007 自由な値を1つずつ足し、要らない値を消して届けられる", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  await expect.poll(() => tokens(frame)).toEqual(["dist", "node_modules"])
  const editor = frame.getByRole("textbox", { name: "除外するパス" })
  await editor.click()
  await editor.press("Backspace")
  await expect.poll(() => tokens(frame)).toEqual(["dist"])
  await editor.pressSequentially("coverage")
  await editor.press("Enter")
  await expect.poll(() => tokens(frame)).toEqual(["dist", "coverage"])
  const outcome = await send(invoked)
  expect(outcome.values["ignore"]).toEqual(["dist", "coverage"])
})

test("REQ-ASK-008 数値の範囲はつまみと欄で答え、下限は上限を超えない", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  const lower = frame.getByRole("spinbutton", { name: "Minimum Node.jsの版" })
  const upper = frame.getByRole("spinbutton", { name: "Maximum Node.jsの版" })
  await frame.getByRole("slider", { name: "Minimum Node.jsの版" }).focus()
  await press(session.window, ...Array.from({ length: 6 }, () => "ArrowRight"))
  await expect.poll(async () => [await lower.inputValue(), await upper.inputValue()]).toEqual(["22", "22"])
  await upper.fill("24")
  await upper.press("Tab")
  await lower.fill("20")
  await lower.press("Tab")
  await expect(lower).toHaveValue("20")
  const outcome = await send(invoked)
  expect(outcome.values["node"]).toEqual([20, 24])
})

test("REQ-ASK-009 日付はカレンダーから範囲の中だけ選べ、時刻はキーボードで入れると刻みに丸まる", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  const date = frame.getByRole("textbox", { name: "リリース日" })
  const calendar = frame.getByRole("button", { name: "Open the calendar for リリース日" })
  const grid = frame.getByRole("grid")
  await calendar.click()
  await expect(grid).toBeVisible()
  await press(session.window, "ArrowRight", "Enter")
  await expect(grid).toBeHidden()
  await expect(date).toHaveValue("12/02/2026")
  await calendar.click()
  await press(session.window, "PageUp")
  await expect(grid.locator("[aria-disabled='true']").filter({ hasText: /^24$/ })).toHaveCount(1)
  await press(session.window, "Escape")
  await expect(grid).toBeHidden()
  await frame.getByRole("spinbutton", { name: "hour" }).click()
  await session.window.keyboard.type("1112")
  await expect(frame.getByRole("spinbutton", { name: "minute" })).toHaveValue("00")
  const outcome = await send(invoked)
  expect(outcome.values).toMatchObject({ release: "2026-12-02", deploy: "11:00" })
})

test("REQ-ASK-010 木を矢印キーで開閉して移動し、チェックした項目が届く", async ({ session }) => {
  const invoked = await showKinds(session)
  const { frame } = invoked
  const tree = frame.getByRole("tree", { name: "検査する範囲" })
  const src = tree.getByRole("treeitem", { name: "src" })
  await expect(tree.getByRole("treeitem", { name: "ui" })).toBeVisible()
  await src.focus()
  await press(session.window, "ArrowLeft")
  await expect(tree.getByRole("treeitem", { name: "ui" })).toBeHidden()
  await press(session.window, "ArrowRight")
  await expect(tree.getByRole("treeitem", { name: "ui" })).toBeVisible()
  await press(session.window, "ArrowDown", "ArrowDown", "Space", "ArrowDown", "Space")
  await expect(src).toHaveAttribute("aria-checked", "true")
  const outcome = await send(invoked)
  expect(outcome.values["scope"]).toEqual(["src", "README.md"])
})

test("REQ-ANS-004 マウスを使わずに項目を移り、値を変えて⌘/Ctrl+Enterで送信できる", async ({ session }) => {
  const invoked = await invokeForm(session)
  const { frame } = invoked
  const attendees = frame.getByRole("spinbutton", { name: "参加者数" })
  await frame.getByRole("textbox", { name: "イベント名" }).focus()
  for (let step = 0; step < 20 && !(await attendees.evaluate((node) => node === document.activeElement)); step += 1) {
    await session.window.keyboard.press("Tab")
  }
  await expect(attendees).toBeFocused()
  await session.window.keyboard.press("ArrowUp")
  await expect(attendees).toHaveValue("130")
  const { keyboard } = session.window
  await keyboard.down("ControlOrMeta")
  await keyboard.down("Enter")
  const outcome = await outcomeOf(invoked)
  await keyboard.up("Enter")
  await keyboard.up("ControlOrMeta")
  expect(outcome.status).toBe("submitted")
  expect(outcome.values["attendees"]).toBe(130)
  expect(outcome.changedByUser).toEqual(["attendees"])
})
