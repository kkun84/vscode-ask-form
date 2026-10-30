import { expect, test, type Frame, type Page } from "@playwright/test"
import AxeBuilder from "../support/axe.ts"
import { eventSpec } from "../fixtures/event.ts"
import { openForm, recorded, startServer, type HarnessServer, type PageOptions } from "../support/ui.ts"
import { themeContext, type ThemeName } from "../support/themes.ts"

let server: HarnessServer

test.beforeAll(async () => {
  server = await startServer()
})

test.afterAll(async () => {
  await server.close()
})

const open = (page: Page, options: Partial<PageOptions> = {}): Promise<Frame> => openForm(page, server, { args: eventSpec, ...options })

const themes = ["dark", "light", "highContrast"] as const satisfies ReadonlyArray<ThemeName>

const setPrice = async (frame: Frame, value: string) => {
  const input = frame.getByRole("spinbutton", { name: "参加費" })
  await input.fill(value)
  await input.press("Tab")
}

const openResend = async (page: Page, options: Partial<PageOptions>) => {
  const frame = await open(page, options)
  await frame.getByRole("button", { name: "この内容で進める" }).click()
  await frame.getByRole("button", { name: "変更して送り直す" }).click()
  return frame
}

interface OutcomeLike {
  readonly status: string
  readonly values?: Record<string, unknown>
  readonly changedByUser?: ReadonlyArray<string>
}

test.describe("SPEC-UI-001 初期表示", () => {
  test("SPEC-UI-001 推測値と根拠を表示し、変えた項目は「あなたが変更」にする", async ({ page }) => {
    const frame = await open(page)
    await expect(frame.getByLabel("イベント名")).toHaveValue("技術交流会 2026")
    await expect(frame.getByRole("radio", { name: "交流会" })).toBeChecked()
    await expect(frame.getByText("AIの推測: README.mdより")).toBeVisible()
    await frame.getByLabel("イベント名").fill("技術交流会 秋")
    await expect(frame.getByText("AIの推測: README.mdより")).toHaveCount(0)
    await expect(frame.getByText("あなたが変更")).toBeVisible()
  })

  test("SPEC-UI-001 advancedの項目は閉じた「詳細」の中にある", async ({ page }) => {
    const frame = await open(page)
    const details = frame.locator("details.advanced")
    await expect(details).not.toHaveAttribute("open", "")
    await expect(details.getByRole("group", { name: "配布物" })).toBeHidden()
    await details.locator("summary").click()
    await expect(details.getByRole("group", { name: "配布物" })).toBeVisible()
  })
})

test.describe("SPEC-UI-002 計算結果", () => {
  test("SPEC-UI-002 値を変えると計算結果がすぐ変わり、primaryは大きく表示する", async ({ page }) => {
    const frame = await open(page)
    const profit = frame.locator(".metric.primary .metric-value")
    await expect(profit).toHaveText("¥70,000")
    await setPrice(frame, "2500")
    await expect(profit).toHaveText("¥130,000")
    await frame.getByRole("switch", { name: "ライブ配信" }).uncheck()
    await expect(profit).toHaveText("¥160,000")
    const size = await profit.evaluate((node) => Number(getComputedStyle(node).fontSize.replace("px", "")))
    expect(size).toBeGreaterThan(16)
  })
})

test.describe("SPEC-UI-003 回答の操作", () => {
  test("SPEC-UI-003 主ボタンで変えた値を回答する", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("radio", { name: "勉強会" }).check()
    await frame.getByRole("button", { name: "この内容で進める" }).click()
    await expect.poll(() => recorded<OutcomeLike>(page, "outcomes")).toHaveLength(1)
    const [outcome] = await recorded<OutcomeLike>(page, "outcomes")
    expect(outcome?.status).toBe("submitted")
    expect(outcome?.changedByUser).toEqual(["format"])
  })

  test("SPEC-UI-003 ⌘/Ctrl+Enterで主ボタンと同じ操作になる", async ({ page }) => {
    const frame = await open(page)
    await frame.getByLabel("イベント名").press("Control+Enter")
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.status).toBe("submitted")
  })

  test("SPEC-UI-003 AIに任せる、チャットで答えるを選べる", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "AIに任せる" }).click()
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.status).toBe("delegated")
    const other = await page.context().newPage()
    const second = await open(other)
    await second.getByRole("button", { name: "チャットで答える" }).click()
    await expect.poll(async () => (await recorded<OutcomeLike>(other, "outcomes"))[0]?.status).toBe("answer_in_chat")
  })
})

test.describe("SPEC-UI-003 入力の確定", () => {
  test("SPEC-UI-003 入力中の数値は⌘/Ctrl+Enterの前に範囲内に確定してから回答する", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("spinbutton", { name: "参加者数" }).fill("900")
    await frame.getByRole("spinbutton", { name: "参加者数" }).press("Control+Enter")
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.values?.["attendees"]).toBe(300)
    await expect(frame.locator(".summary-row", { hasText: "参加者数" })).toContainText("300人")
  })
})

test.describe("SPEC-UI-004 回答後の要約", () => {
  test("SPEC-UI-004 回答後は要約になり、利用者が変えた項目に印を付ける", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
    await frame.getByRole("button", { name: "この内容で進める" }).click()
    const summary = frame.locator(".summary")
    await expect(summary.getByText("回答しました")).toBeVisible()
    await expect(summary.locator(".summary-row", { hasText: "参加者数" })).toContainText("150人あなたが変更")
    await expect(summary.locator(".summary-row", { hasText: "参加費" })).not.toContainText("あなたが変更")
  })

  test("SPEC-UI-004 ツールの結果を受け取ったときも要約を表示する", async ({ page }) => {
    const frame = await open(page, {
      restore: { status: "delegated", values: { ...defaults(), price: 3000 }, computed: {} }
    })
    await expect(frame.locator(".summary").getByText("AIに任せました")).toBeVisible()
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥3,000")
  })

  test("SPEC-UI-004 チャットで答える場合は値を示さない", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "チャットで答える" }).click()
    await expect(frame.getByText("チャットで答えることにしました")).toBeVisible()
    await expect(frame.locator(".summary-row")).toHaveCount(0)
    await expect(frame.getByRole("button", { name: "変更して送り直す" })).toHaveCount(0)
  })
})

test.describe("SPEC-UI-005 送り直し", () => {
  test("SPEC-UI-005 変えた項目の数を示し、変更がなければ送れない", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "この内容で進める" }).click()
    await frame.getByRole("button", { name: "変更して送り直す" }).click()
    const send = frame.getByRole("button", { name: "変更を送信" })
    await expect(send).toBeDisabled()
    await expect(frame.getByText("変更はまだありません")).toBeVisible()
    await setPrice(frame, "2500")
    await expect(frame.getByText("1項目を変更")).toBeVisible()
    await expect(frame.getByText("前回の送信から変更")).toBeVisible()
    await send.click()
    await expect.poll(() => recorded<{ readonly text: string }>(page, "resends")).toHaveLength(1)
    const [resend] = await recorded<{ readonly text: string }>(page, "resends")
    expect(resend?.text).toBe("「交流会の条件」で参加費を¥2,500に変えたので、反映して続けてください。")
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥2,500")
    await frame.getByRole("button", { name: "変更して送り直す" }).click()
    await expect(frame.getByRole("button", { name: "変更を送信" })).toBeDisabled()
  })

  test("SPEC-UI-005 送れなかったときは理由を示して編集を続けられる", async ({ page }) => {
    const frame = await openResend(page, { failResend: true })
    await frame.getByRole("switch", { name: "ライブ配信" }).uncheck()
    await frame.getByRole("button", { name: "変更を送信" }).click()
    await expect(frame.getByText(/送信できませんでした/)).toBeVisible()
    await expect(frame.getByRole("button", { name: "変更を送信" })).toBeEnabled()
  })
})

test.describe("SPEC-UI-005 送信中", () => {
  test("SPEC-UI-005 送り直しの送信中は編集できず、送った値が要約に残る", async ({ page }) => {
    const frame = await openResend(page, { holdResend: true })
    await setPrice(frame, "2500")
    await frame.getByRole("button", { name: "変更を送信" }).click()
    await expect(frame.locator("form.card")).toHaveJSProperty("inert", true)
    await page.evaluate(() => (window as unknown as { harness: { release: () => void } }).harness.release())
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥2,500")
  })
})

const statusRequests = async (page: Page) =>
  (await recorded<{ readonly method?: string; readonly params?: { readonly name?: string } }>(page, "messages")).filter(
    (message) => message.method === "tools/call" && message.params?.name === "form_status"
  ).length

const releaseStatus = (page: Page, result: Record<string, unknown>) =>
  page.evaluate(
    (value) => (window as unknown as { harness: { releaseStatus: (reply: Record<string, unknown>) => void } }).harness.releaseStatus(value),
    result
  )

const openWithStatus = async (page: Page) => {
  const frame = await open(page, { holdStatus: true })
  await expect.poll(() => statusRequests(page)).toBe(1)
  return frame
}

test.describe("SPEC-UI-006 中断と期限切れ", () => {
  for (const omitCancellation of [false, true]) {
    test(`SPEC-UI-006 中断通知${omitCancellation ? "なしでもサーバーの状態から" : "で"}回答できなくなる`, async ({ page }) => {
      const frame = await open(page, { omitCancellation, context: { locale: "en" } })
      await expect.poll(() => statusRequests(page)).toBeGreaterThan(0)
      await page.evaluate(() => (window as unknown as { harness: { cancel: () => void } }).harness.cancel())
      await expect(frame.locator("#app > .closed[role='status']")).toHaveText("Cancelled")
      await expect(frame.getByRole("button")).toHaveCount(0)
      const requests = await statusRequests(page)
      await page.clock.install()
      await page.clock.runFor(3000)
      expect(await statusRequests(page)).toBe(requests)
    })
  }

  test("SPEC-UI-006 未登録や通信の誤りを中断と扱わず、次の状態を確認する", async ({ page }) => {
    const frame = await openWithStatus(page)
    await releaseStatus(page, { structuredContent: { status: "unknown" } })
    await expect.poll(() => statusRequests(page)).toBe(2)
    await releaseStatus(page, { isError: true, structuredContent: { status: "cancelled" } })
    await expect.poll(() => statusRequests(page)).toBe(3)
    await expect(frame.locator("form.card")).toBeVisible()
    await releaseStatus(page, { structuredContent: { status: "cancelled" } })
    await expect(frame.locator(".closed")).toHaveText("キャンセルされました")
  })

  test("SPEC-UI-006 遅れて届いた中断の状態は回答済みの要約を閉じない", async ({ page }) => {
    const frame = await openWithStatus(page)
    await frame.getByRole("button", { name: "AIに任せる" }).click()
    await expect(frame.locator(".summary")).toBeVisible()
    await releaseStatus(page, { structuredContent: { status: "cancelled" } })
    await page.clock.install()
    await page.clock.runFor(3000)
    await expect(frame.locator(".summary")).toBeVisible()
    expect(await statusRequests(page)).toBe(1)
  })

  test("SPEC-UI-006 中断の後にツールの結果が届いてもフォームを再開しない", async ({ page }) => {
    const frame = await open(page)
    await page.evaluate(() => (window as unknown as { harness: { cancel: () => void } }).harness.cancel())
    await expect(frame.locator(".closed")).toBeVisible()
    await frame.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "answer_in_chat" } } }
        })
      )
    })
    await expect(frame.locator(".closed")).toHaveText("キャンセルされました")
    await expect(frame.getByRole("button")).toHaveCount(0)
  })

  test("SPEC-UI-006 受け付けられないと返されると期限切れを示す", async ({ page }) => {
    const frame = await open(page, { expireOnAnswer: true })
    await frame.getByRole("button", { name: "この内容で進める" }).click()
    await expect(frame.getByText("この質問は終了しています")).toBeVisible()
    await expect(frame.getByRole("button")).toHaveCount(0)
  })
})

test.describe("SPEC-UI-007 テーマ", () => {
  test("SPEC-UI-007 ホストから受け取った色の変数で表示する", async ({ page }) => {
    const frame = await open(page, { context: themeContext("light") })
    const background = await frame.locator("form.card").evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(background).toBe("rgb(248, 248, 248)")
  })
})

test.describe("SPEC-UI-008 アクセシビリティ", () => {
  test("SPEC-UI-008 キーボードだけで項目を移動して回答できる", async ({ page }) => {
    const frame = await open(page)
    await frame.getByLabel("イベント名").focus()
    for (let i = 0; i < 40; i++) {
      const focused = await frame.evaluate(() => document.activeElement?.textContent ?? "")
      if (focused === "この内容で進める") {
        break
      }
      await page.keyboard.press("Tab")
    }
    await page.keyboard.press("Enter")
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.status).toBe("submitted")
  })
})

for (const name of themes) {
  test.describe(`${name}テーマ`, () => {
    test(`SPEC-UI-007 ${name}テーマの見た目が基準と一致する`, async ({ page }) => {
      const frame = await open(page, { context: themeContext(name) })
      await expect(frame.locator("form.card")).toHaveScreenshot(`form-${name}.png`)
    })
    test(`SPEC-UI-008 ${name}テーマでaxeの違反がない`, async ({ page }) => {
      const frame = await open(page, { context: themeContext(name) })
      await frame.locator("details.advanced summary").click()
      const results = await new AxeBuilder(frame).analyze()
      expect(
        results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
      ).toEqual([])
    })
  })
}

test.describe("SPEC-UI-009 表示の言語", () => {
  test("SPEC-UI-009 英語のロケールでは英語で表示する", async ({ page }) => {
    const frame = await open(page, { context: { locale: "en-US" } })
    await expect(frame.getByRole("button", { name: "Let AI decide" })).toBeVisible()
    await expect(frame.getByRole("button", { name: "Answer in chat" })).toBeVisible()
    await expect(frame.getByText("AI guess: README.mdより")).toBeVisible()
  })
})

test.describe("ARCH-UI-001 画面の通信は1種類", () => {
  test("ARCH-UI-001 画面はMCP Appsの約束事どおりに初期化して回答する", async ({ page }) => {
    await open(page)
    const frame = page.frame({ url: /form\.html$/ })
    await frame?.getByRole("button", { name: "AIに任せる" }).click()
    await expect
      .poll(() => recorded<Record<string, unknown>>(page, "messages"))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "ui/initialize" }),
          expect.objectContaining({ method: "ui/notifications/initialized" }),
          expect.objectContaining({ method: "tools/call", params: expect.objectContaining({ name: "form_answer" }) })
        ])
      )
  })
})

const defaults = () => ({
  name: "技術交流会 2026",
  format: "meetup",
  attendees: 120,
  price: 2000,
  stream: true,
  extras: ["sticker"],
  venue: 140000
})
