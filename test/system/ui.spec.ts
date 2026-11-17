import { expect, test, type Frame, type Page } from "@playwright/test"
import AxeBuilder from "../support/axe.ts"
import { eventSpec } from "../fixtures/event.ts"
import { storageSpec } from "../fixtures/storage.ts"
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

const openStorage = (page: Page) => open(page, { args: storageSpec })

const themes = ["dark", "light", "highContrast"] as const satisfies ReadonlyArray<ThemeName>

const setPrice = async (frame: Frame, value: string) => {
  const input = frame.getByRole("spinbutton", { name: "参加費" })
  await input.fill(value)
  await input.press("Tab")
}

const startEditing = async (frame: Frame) => {
  await frame.getByRole("button", { name: "送信", exact: true }).click()
  await frame.getByRole("button", { name: "変更して送り直す" }).click()
}

const openResend = async (page: Page, options: Partial<PageOptions>) => {
  const frame = await open(page, options)
  await startEditing(frame)
  return frame
}

interface OutcomeLike {
  readonly status: string
  readonly values?: Record<string, unknown>
  readonly changedByUser?: ReadonlyArray<string>
}

const selectStorage = async (frame: Frame, name: string) => {
  await frame.getByRole("radio", { name }).check()
}

const axeViolations = async (frame: Frame): Promise<ReadonlyArray<string>> => {
  await frame.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
  const results = await new AxeBuilder(frame).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
}

const openWithTalk = async (page: Page): Promise<Frame> => {
  const frame = await open(page)
  await frame.getByRole("radio", { name: "勉強会" }).check()
  return frame
}

const singleOutcome = async (page: Page): Promise<OutcomeLike | undefined> => {
  await expect.poll(() => recorded<OutcomeLike>(page, "outcomes")).toHaveLength(1)
  const [outcome] = await recorded<OutcomeLike>(page, "outcomes")
  return outcome
}

test.describe("SPEC-UI-001 初期表示", () => {
  test("SPEC-UI-001 推奨の値と理由を示し、変えたら推奨に戻せる", async ({ page }) => {
    const frame = await open(page)
    const name = frame.getByRole("textbox", { name: "イベント名" })
    await expect(name).toHaveValue("技術交流会 2026")
    await expect(frame.getByRole("radio", { name: "交流会 推奨" })).toBeChecked()
    await expect(frame.locator(".rec", { hasText: "README.mdより" })).toContainText("推奨技術交流会 2026")
    const back = frame.getByRole("button", { name: "推奨に戻す" })
    await expect(back).toBeHidden()
    await name.fill("技術交流会 秋")
    await back.click()
    await expect(name).toHaveValue("技術交流会 2026")
    await expect(name).toBeFocused()
    await expect(back).toBeHidden()
  })

  test("SPEC-UI-001 選択肢をポインターで選ぶと詳しい説明と推奨の理由を畳み、見出しで開き直せる", async ({ page }) => {
    const frame = await open(page)
    const why = frame.locator(".option .rec", { hasText: "依頼文より" })
    await expect(why).toBeVisible()
    await expect(frame.getByRole("radio", { name: "交流会 推奨" })).toHaveAccessibleDescription(/依頼文より/)
    await frame.getByText("勉強会", { exact: true }).click()
    await expect(why).toBeHidden()
    await expect(frame.getByRole("radio", { name: "交流会 推奨" })).not.toHaveAccessibleDescription(/依頼文より/)
    const toggle = frame.getByRole("button", { name: "形式の詳しい説明" })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await frame.getByText("形式", { exact: true }).click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(why).toBeVisible()
  })

  test("SPEC-UI-001 理由のない推奨の値も示し、推奨に戻せる", async ({ page }) => {
    const frame = await open(page, { args: { title: "t", fields: [{ type: "text", id: "word", label: "言葉", default: "hi" }] } })
    const word = frame.getByRole("textbox", { name: "言葉" })
    await expect(frame.locator(".rec")).toContainText("推奨hi")
    await word.fill("yo")
    await frame.getByRole("button", { name: "推奨に戻す" }).click()
    await expect(word).toHaveValue("hi")
  })

  test("SPEC-UI-001 推奨のない選択肢は何も選ばずに始め、答えるか保留にするまで送信できない", async ({ page }) => {
    const frame = await open(page, {
      args: {
        title: "t",
        fields: [
          {
            type: "choice",
            id: "color",
            label: "色",
            options: [
              { value: "a", label: "赤" },
              { value: "b", label: "青" }
            ]
          }
        ]
      }
    })
    await expect(frame.getByRole("radio", { name: "赤" })).not.toBeChecked()
    await expect(frame.getByRole("radio", { name: "青" })).not.toBeChecked()
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    await expect(frame.getByText("答えるか保留にしてください: 色")).toBeVisible()
    await expect(frame.getByRole("radio", { name: "赤" })).toBeFocused()
    await expect(frame.getByRole("radio", { name: "赤" })).toHaveAttribute("aria-invalid", "true")
    expect(await recorded(page, "outcomes")).toHaveLength(0)
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

test.describe("SPEC-UI-001 推奨の示し方", () => {
  test("SPEC-UI-001 選択肢の推奨は、詳しい理由だけでも示す", async ({ page }) => {
    const frame = await open(page, {
      args: {
        title: "t",
        fields: [
          {
            type: "choice",
            id: "color",
            label: "色",
            default: "a",
            reasonDetails: "画面の他の部分と合わせました。",
            options: [
              { value: "a", label: "赤" },
              { value: "b", label: "青" }
            ]
          }
        ]
      }
    })
    await expect(frame.locator(".option .rec")).toContainText("画面の他の部分と合わせました。")
    await expect(frame.getByRole("button", { name: "色の詳しい説明" })).toBeVisible()
  })
})

test.describe("SPEC-UI-002 計算結果", () => {
  test("SPEC-UI-002 値を変えると計算結果がすぐ変わり、primaryは大きく表示する", async ({ page }) => {
    const frame = await open(page)
    const profit = frame.locator(".metric.primary .metric-value")
    await expect(profit).toHaveText("¥70,000")
    await setPrice(frame, "2500")
    await expect(profit).toHaveText("¥130,000")
    await frame.getByRole("radio", { name: "なし" }).check()
    await expect(profit).toHaveText("¥160,000")
    const size = await profit.evaluate((node) => Number(getComputedStyle(node).fontSize.replace("px", "")))
    expect(size).toBeGreaterThan(16)
  })
})

test.describe("SPEC-UI-003 回答の操作", () => {
  test("SPEC-UI-003 主ボタンで変えた値を回答する", async ({ page }) => {
    const frame = await openWithTalk(page)
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    const outcome = await singleOutcome(page)
    expect(outcome?.status).toBe("submitted")
    expect(outcome?.changedByUser).toEqual(["format"])
  })

  test("SPEC-UI-003 ⌘/Ctrl+Enterで主ボタンと同じ操作になる", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("textbox", { name: "イベント名" }).press("Control+Enter")
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.status).toBe("submitted")
  })

  test("SPEC-UI-003 操作は送信とキャンセルの2つで、キャンセルは回答せずに閉じる", async ({ page }) => {
    const frame = await open(page)
    await expect(frame.locator("footer").getByRole("button")).toHaveText(["キャンセル", "送信"])
    await frame.getByRole("button", { name: "キャンセル" }).click()
    await expect.poll(async () => (await recorded<OutcomeLike>(page, "outcomes"))[0]?.status).toBe("answer_in_chat")
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
  test("SPEC-UI-004 回答後は要約になり、推奨から変えた項目に元の推奨を添える", async ({ page }) => {
    const frame = await openWithTalk(page)
    await frame.getByRole("spinbutton", { name: "参加者数" }).fill("150")
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    const summary = frame.locator(".summary")
    await expect(summary.getByText("送信しました")).toBeFocused()
    await expect(summary.locator(".summary-row", { hasText: "形式" })).toHaveText("形式勉強会推奨: 交流会")
    await expect(summary.locator(".summary-row", { hasText: "参加者数" })).toHaveText("参加者数150人推奨: 120人")
  })

  test("SPEC-UI-004 ツールの結果を受け取ったときも要約を表示する", async ({ page }) => {
    const frame = await open(page, {
      restore: { status: "submitted", values: { ...defaults(), price: 3000 }, held: [], changedByUser: ["price"], computed: {} }
    })
    await expect(frame.locator(".summary").getByText("送信しました")).toBeVisible()
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥3,000")
  })

  test("SPEC-UI-004 キャンセルした場合は値を示さない", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "キャンセル" }).click()
    await expect(frame.getByText("回答せずに閉じました")).toBeVisible()
    await expect(frame.locator(".summary-row")).toHaveCount(0)
    await expect(frame.getByRole("button", { name: "変更して送り直す" })).toHaveCount(0)
  })
})

test("SPEC-UI-004 質問せずに進めた結果を受け取ると、その旨を示して回答を受け付けない", async ({ page }) => {
  const frame = await open(page, { restore: { status: "unavailable", next: "" } })
  await expect(frame.locator(".summary")).toHaveText("✓質問に自動で応じる設定(chat.autoReply)が有効なため、質問せずに進めました")
  await expect(frame.getByRole("button")).toHaveCount(0)
})

test.describe("SPEC-UI-005 送り直し", () => {
  test("SPEC-UI-005 変えた項目の数を示し、変更がなければ送れない", async ({ page }) => {
    const frame = await open(page)
    await startEditing(frame)
    const send = frame.getByRole("button", { name: "変更を送信" })
    await expect(send).toBeDisabled()
    await expect(frame.getByText("変更はまだありません")).toBeVisible()
    await setPrice(frame, "2500")
    await expect(frame.getByText("1項目を変更")).toBeVisible()
    await expect(frame.getByText("前回: ¥2,000")).toBeVisible()
    await send.click()
    await expect.poll(() => recorded<{ readonly text: string }>(page, "resends")).toHaveLength(1)
    const [resend] = await recorded<{ readonly text: string }>(page, "resends")
    expect(resend?.text).toBe("「交流会の条件」で参加費を¥2,500に変えたので、反映して続けてください。")
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥2,500")
    await frame.getByRole("button", { name: "変更して送り直す" }).click()
    await expect(send).toBeEnabled()
    await setPrice(frame, "2000")
    await expect(send).toBeDisabled()
  })

  test("SPEC-UI-005 送れなかったときは理由を示して編集を続けられる", async ({ page }) => {
    const frame = await openResend(page, { failResend: true })
    await frame.getByRole("radio", { name: "なし" }).check()
    await frame.getByRole("button", { name: "変更を送信" }).click()
    await expect(frame.getByText(/送信できませんでした/)).toBeVisible()
    await expect(frame.getByRole("button", { name: "変更を送信" })).toBeEnabled()
  })
})

const sendChange = async (frame: Frame) => {
  await frame.getByRole("radio", { name: "なし" }).check()
  await frame.getByRole("button", { name: "変更を送信" }).click()
}

test.describe("SPEC-UI-005 フォームの会話への送り直し", () => {
  test("SPEC-UI-005 文章と添付をフォームの会話の入力欄に置き、利用者による送信を案内する", async ({ page }) => {
    const frame = await openResend(page, { placeMessage: "placed" })
    await sendChange(frame)
    await expect(frame.locator(".summary-row", { hasText: "ライブ配信" })).toBeVisible()
    const messages = await recorded<{ readonly method?: string; readonly params?: { readonly name?: string; readonly content?: unknown } }>(
      page,
      "messages"
    )
    const order = messages.flatMap((message) =>
      message.method === "ui/message"
        ? ["ui/message"]
        : message.params?.name === "form_resend" || message.params?.name === "form_send"
          ? [message.params.name]
          : []
    )
    expect(order).toEqual(["form_resend", "ui/message"])
    await expect(frame.locator(".summary .notice")).toHaveText("チャットの入力欄に入れました。内容を確かめて送信してください")
    expect(messages.find((message) => message.method === "ui/message")?.params?.content).toEqual([
      { type: "text", text: "「交流会の条件」でライブ配信をなしに変えたので、反映して続けてください。" },
      { type: "resource_link", uri: "ask-form://answers/1/form.json", name: "form.json", mimeType: "application/json" }
    ])
  })

  test("SPEC-UI-005 下書き後も回答を基準にし、最新の編集値を要約に保つ", async ({ page }) => {
    const baseline = { ...defaults(), price: 3000 }
    const frame = await open(page, {
      restore: { status: "submitted", values: baseline, computed: {} }
    })
    const edit = frame.getByRole("button", { name: "変更して送り直す" })
    const send = frame.getByRole("button", { name: "変更を送信" })
    await edit.click()
    for (const price of ["2500", "4000"]) {
      await setPrice(frame, price)
      await send.click()
      await expect(frame.locator(".summary .notice")).toHaveText("チャットの入力欄に入れました。内容を確かめて送信してください")
      await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText(`¥${Number(price).toLocaleString("en-US")}`)
      await edit.click()
      await expect(send).toBeEnabled()
    }
    const calls = await recorded<{ readonly params?: { readonly name?: string; readonly arguments?: { readonly before?: unknown } } }>(
      page,
      "messages"
    )
    expect(calls.filter((call) => call.params?.name === "form_resend").map((call) => call.params?.arguments?.before)).toEqual([
      baseline,
      baseline
    ])
    await setPrice(frame, "3000")
    await expect(send).toBeDisabled()
    await frame.getByRole("button", { name: "キャンセル", exact: true }).click()
    await expect(frame.locator(".summary-row", { hasText: "参加費" })).toContainText("¥4,000")
  })

  test("SPEC-UI-005 入力欄に置けなければ送信させず、会話を開くよう示す", async ({ page }) => {
    const frame = await openResend(page, { placeMessage: "refused" })
    await sendChange(frame)
    await expect(frame.getByText("このフォームのある会話を開き、入力欄を空にしてから、もう一度送ってください")).toBeVisible()
    await expect(frame.getByRole("button", { name: "変更を送信" })).toBeEnabled()
    const messages = await recorded<{ readonly params?: { readonly name?: string } }>(page, "messages")
    expect(messages.some((message) => message.params?.name === "form_send")).toBe(false)
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

const expectCancelled = async (frame: Frame) => {
  await expect(frame.locator(".closed")).toHaveText("キャンセルされました")
  await expect(frame.getByRole("button")).toHaveCount(0)
}

test.describe("SPEC-UI-006 中断と期限切れ", () => {
  test("SPEC-UI-006 読み込み前の中断は初期化後すぐ表示し、状態の確認を待たない", async ({ page }) => {
    await page.route("**/form.html", async (route) => {
      await page.evaluate(() => (window as unknown as { harness: { cancel: () => void } }).harness.cancel())
      await route.continue()
    })
    const frame = await open(page, { holdStatus: true })
    await expectCancelled(frame)
  })

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
    await frame.getByRole("button", { name: "送信", exact: true }).click()
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
    await page.evaluate(() => {
      document
        .querySelector<HTMLIFrameElement>("#form")
        ?.contentWindow?.postMessage(
          { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "answer_in_chat" } } },
          window.location.origin
        )
    })
    await expectCancelled(frame)
  })

  test("SPEC-UI-006 受け付けられないと返されると期限切れを示す", async ({ page }) => {
    const frame = await open(page, { expireOnAnswer: true })
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    await expect(frame.getByText("この質問は終了しています")).toBeVisible()
    await expect(frame.getByRole("button")).toHaveCount(0)
  })
})

test("SPEC-UI-010 別のフレームから偽の中断や結果が届いても回答を続けられる", async ({ page }) => {
  const frame = await open(page)
  await page.evaluate(() => {
    const sibling = document.createElement("iframe")
    sibling.name = "untrusted"
    document.body.append(sibling)
  })
  const sibling = page.frame("untrusted")
  expect(sibling).not.toBeNull()
  await sibling?.evaluate(() => {
    const form = window.parent.document.querySelector<HTMLIFrameElement>("#form")?.contentWindow
    form?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" }, "*")
    form?.postMessage(
      { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "answer_in_chat" } } },
      "*"
    )
  })
  await frame.getByRole("button", { name: "送信", exact: true }).click()
  await expect.poll(() => recorded<OutcomeLike>(page, "outcomes")).toEqual([expect.objectContaining({ status: "submitted" })])
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
    await frame.getByRole("textbox", { name: "イベント名" }).focus()
    for (let i = 0; i < 40; i++) {
      const focused = await frame.evaluate(() => document.activeElement?.textContent ?? "")
      if (focused === "送信") {
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
      expect(await axeViolations(frame)).toEqual([])
    })
  })
}

test.describe("SPEC-UI-011 選択肢ごとの項目", () => {
  test("SPEC-UI-011 選んだ選択肢の項目だけを表示し、切り替えても直した値を覚えておく", async ({ page }) => {
    const frame = await openStorage(page)
    const engine = frame.getByRole("group", { name: "保存方式" })
    const port = frame.getByRole("spinbutton", { name: "ポート" })
    await expect(engine).toBeVisible()
    await expect(port).toBeHidden()
    await selectStorage(frame, "サーバー")
    await expect(engine).toBeHidden()
    await port.fill("3000")
    await selectStorage(frame, "保存しない")
    await expect(port).toBeHidden()
    await selectStorage(frame, "サーバー")
    await expect(port).toHaveValue("3000")
    expect(await axeViolations(frame)).toEqual([])
  })

  test("SPEC-UI-011 回答と要約には選んだ選択肢の項目だけを含める", async ({ page }) => {
    const frame = await openStorage(page)
    await frame.getByRole("radio", { name: "サーバー" }).check()
    await frame.getByRole("spinbutton", { name: "ポート" }).fill("3000")
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    const outcome = await singleOutcome(page)
    expect(outcome?.values).toEqual({ name: "my-todo", storage: "server", port: 3000, auth: "no" })
    expect(outcome?.changedByUser).toEqual(["storage", "port"])
    const summary = frame.locator(".summary")
    await expect(summary.locator(".summary-row")).toHaveText([
      "アプリ名my-todo",
      "保存先サーバー推奨: ブラウザ",
      "ポート3,000推奨: 8,080",
      "ログイン不要"
    ])
  })

  test("SPEC-UI-011 送り直しでは、切り替えて現れた枝の項目も回答からの変更に数える", async ({ page }) => {
    const frame = await openStorage(page)
    await startEditing(frame)
    await frame.getByRole("radio", { name: "サーバー" }).check()
    await expect(frame.locator(".status")).toHaveText("3項目を変更")
  })

  test("SPEC-UI-011 回答した後も、選ばれていない枝で直した値を覚えておく", async ({ page }) => {
    const frame = await openStorage(page)
    await selectStorage(frame, "サーバー")
    const port = frame.getByRole("spinbutton", { name: "ポート" })
    await port.fill("3000")
    await selectStorage(frame, "ブラウザ")
    await expect(port).toBeHidden()
    await startEditing(frame)
    await selectStorage(frame, "サーバー")
    await expect(port).toHaveValue("3000")
  })
})

test.describe("SPEC-UI-009 表示の言語", () => {
  test("SPEC-UI-009 英語のロケールでは英語で表示する", async ({ page }) => {
    const frame = await open(page, { context: { locale: "en-US" } })
    await expect(frame.locator("footer").getByRole("button")).toHaveText(["Cancel", "Send"])
    await expect(frame.getByRole("group", { name: "参加費" }).getByRole("checkbox", { name: "Decide later" })).toBeVisible()
    await expect(frame.getByRole("button", { name: "Details for イベント名" })).toBeVisible()
  })
})

test.describe("ARCH-UI-001 画面の通信は1種類", () => {
  test("ARCH-UI-001 画面はMCP Appsの約束事どおりに初期化して回答する", async ({ page }) => {
    await open(page)
    const frame = page.frame({ url: /form\.html$/ })
    await frame?.getByRole("button", { name: "送信", exact: true }).click()
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
  stream: "yes",
  extras: ["sticker"],
  venue: 140000
})

const followUpSpec = {
  title: "t",
  fields: [
    {
      type: "choice",
      id: "where",
      label: "保存先",
      default: "local",
      options: [
        { value: "local", label: "手元" },
        {
          value: "cloud",
          label: "クラウド",
          fields: [
            {
              type: "choice",
              id: "region",
              label: "地域",
              options: [
                { value: "jp", label: "日本" },
                { value: "us", label: "米国" }
              ]
            }
          ]
        }
      ]
    }
  ]
}

test.describe("SPEC-UI-011 送り直しの続きの質問", () => {
  test("SPEC-UI-011 送り直しで現れた続きの質問が未回答なら送らず、その質問を示す", async ({ page }) => {
    const frame = await open(page, { args: followUpSpec })
    await startEditing(frame)
    await frame.getByRole("radio", { name: "クラウド" }).check()
    await frame.getByRole("button", { name: "変更を送信" }).click()
    await expect(frame.getByText("答えるか保留にしてください: 地域")).toBeVisible()
    await expect(frame.getByRole("radio", { name: "日本" })).toBeFocused()
    expect(await recorded(page, "resends")).toHaveLength(0)
  })
})

const holdSpec = {
  title: "保留の確認",
  fields: [
    {
      type: "choice",
      id: "due",
      label: "締め切り",
      options: [
        { value: "yes", label: "付けられる" },
        { value: "no", label: "付けない" }
      ]
    },
    { type: "number", id: "size", label: "件数", default: 20, min: 5, max: 100, step: 5, suffix: "件" },
    {
      type: "choice",
      id: "tags",
      label: "分類",
      multiple: true,
      default: ["work"],
      options: [
        { value: "work", label: "仕事" },
        { value: "home", label: "家" }
      ]
    },
    { type: "text", id: "memo", label: "補足", default: "なし" }
  ],
  computed: [{ id: "pages", label: "ページ数", expression: "ceil(100 / size)" }]
}

const hold = (frame: Frame, question: string) => frame.getByRole("group", { name: question }).getByLabel("保留")

const openHeld = async (page: Page): Promise<Frame> => {
  const frame = await open(page, { args: holdSpec })
  for (const question of ["締め切り", "件数", "分類"]) {
    await hold(frame, question).check()
  }
  return frame
}

const send = (frame: Frame) => frame.getByRole("button", { name: "送信", exact: true }).click()

const note = (frame: Frame) => frame.getByRole("textbox", { name: "補足を書く" })

test.describe("SPEC-UI-013 補足", () => {
  test("SPEC-UI-013 閉じた補足を開いて書くと、回答と一緒に届き、要約に残る", async ({ page }) => {
    const frame = await open(page)
    await expect(note(frame)).toBeHidden()
    await frame.locator("details.note summary").click()
    await expect(frame.locator("details.note")).toContainText("選択肢にない答えや、Copilotに伝えたいことを書けます")
    await note(frame).fill(" 会場は未定です\n参加費は任せます ")
    expect(await axeViolations(frame)).toEqual([])
    await note(frame).press("ControlOrMeta+Enter")
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly note?: string }
    expect(outcome.note).toBe("会場は未定です\n参加費は任せます")
    await expect(frame.locator(".summary-row").last()).toHaveText("補足会場は未定です\n参加費は任せます")
  })

  test("SPEC-UI-013 補足を書かなければnoteを渡さず、要約にも出さない", async ({ page }) => {
    const frame = await open(page)
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly note?: string }
    expect("note" in outcome).toBe(false)
    await expect(frame.locator(".summary dt", { hasText: "補足" })).toHaveCount(0)
  })

  test("SPEC-UI-013 送り直しの編集には補足を出さない", async ({ page }) => {
    const frame = await open(page)
    await frame.locator("details.note summary").click()
    await note(frame).fill("会場は未定です")
    await startEditing(frame)
    await expect(frame.locator("details.note")).toHaveCount(0)
    await frame.getByRole("button", { name: "キャンセル" }).click()
    await expect(frame.locator(".summary-row").last()).toHaveText("補足会場は未定です")
  })

  test("SPEC-UI-013 ツールの結果から復元した要約にも補足を示す", async ({ page }) => {
    const frame = await open(page, {
      restore: {
        status: "submitted",
        values: { name: "技術交流会 2026" },
        held: [],
        changedByUser: [],
        computed: {},
        note: "会場は未定です"
      }
    })
    await expect(frame.locator(".summary-row").last()).toHaveText("補足会場は未定です")
  })
})

test.describe("SPEC-UI-012 保留", () => {
  test("SPEC-UI-012 どの質問も保留にでき、保留にした質問は値を届けず要約に保留と示す", async ({ page }) => {
    const frame = await openHeld(page)
    await expect(frame.getByRole("checkbox", { name: "仕事" })).not.toBeChecked()
    await frame.getByRole("textbox", { name: "補足" }).fill("")
    await expect(frame.locator(".metric-value")).toHaveText("—")
    await expect(frame.locator(".held-tag")).toHaveText(["保留"])
    for (const question of ["締め切り", "件数", "分類"]) {
      await expect(hold(frame, question)).toBeChecked()
    }
    expect(await axeViolations(frame)).toEqual([])
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly held?: ReadonlyArray<string> }
    expect(outcome.values).toEqual({})
    expect(outcome.held).toEqual(["due", "size", "tags", "memo"])
    expect(outcome.changedByUser).toEqual([])
    await expect(frame.locator(".summary-row")).toHaveText([
      "締め切り保留",
      "件数保留推奨: 20件",
      "分類保留推奨: 仕事",
      "補足保留推奨: なし"
    ])
  })

  test("SPEC-UI-012 値を入れるか選ぶと保留が外れる", async ({ page }) => {
    const frame = await openHeld(page)
    await frame.getByRole("radio", { name: "付けない" }).check()
    await frame.getByRole("spinbutton", { name: "件数" }).fill("50")
    await frame.getByRole("checkbox", { name: "家" }).check()
    await expect(hold(frame, "締め切り")).not.toBeChecked()
    await expect(hold(frame, "件数")).not.toBeChecked()
    await expect(hold(frame, "分類")).not.toBeChecked()
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly held?: ReadonlyArray<string> }
    expect(outcome.values).toEqual({ due: "no", size: 50, tags: ["home"], memo: "なし" })
    expect(outcome.held).toEqual([])
  })

  test("SPEC-UI-012 数値の保留を外すと、保留にする前の値に戻る", async ({ page }) => {
    const frame = await open(page, { args: holdSpec })
    const size = frame.getByRole("spinbutton", { name: "件数" })
    await size.fill("35")
    await hold(frame, "件数").check()
    await expect(size).toHaveValue("")
    await hold(frame, "件数").uncheck()
    await expect(size).toHaveValue("35")
    await expect(frame.locator(".metric-value")).toHaveText("3")
  })

  test("SPEC-UI-012 親の選択項目を保留にすると、選択肢ごとの項目を隠して回答にも含めない", async ({ page }) => {
    const frame = await openStorage(page)
    await hold(frame, "保存先").first().check()
    await expect(frame.getByRole("group", { name: "保存方式" })).toBeHidden()
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly held?: ReadonlyArray<string> }
    expect(outcome.values).toEqual({ name: "my-todo" })
    expect(outcome.held).toEqual(["storage"])
  })
})

test.describe("SPEC-UI-012 保留と送り直し", () => {
  test("SPEC-UI-012 保留で送信した質問に、送り直しで答えられる", async ({ page }) => {
    const frame = await open(page, { args: holdSpec })
    await hold(frame, "締め切り").check()
    await send(frame)
    await frame.getByRole("button", { name: "変更して送り直す" }).click()
    await expect(hold(frame, "締め切り")).toBeChecked()
    await expect(frame.locator(".status")).toHaveText("変更はまだありません")
    await frame.getByRole("radio", { name: "付けられる" }).check()
    await expect(frame.getByText("前回: 保留")).toBeVisible()
    await frame.getByRole("button", { name: "変更を送信" }).click()
    await expect.poll(() => recorded<{ readonly text: string; readonly values: unknown }>(page, "resends")).toHaveLength(1)
    const [resent] = await recorded<{ readonly text: string; readonly values: unknown; readonly held: unknown }>(page, "resends")
    expect(resent?.text).toBe("「保留の確認」で締め切りを付けられるに変えたので、反映して続けてください。")
    expect(resent?.values).toEqual({ due: "yes", size: 20, tags: ["work"], memo: "なし" })
    expect(resent?.held).toEqual([])
  })

  test("SPEC-UI-012 ツールの結果から復元した要約でも、保留の質問を保留のまま編集に戻す", async ({ page }) => {
    const frame = await open(page, {
      args: holdSpec,
      restore: { status: "submitted", values: { due: "no", tags: ["work"] }, held: ["size", "memo"], changedByUser: ["due"], computed: {} }
    })
    await expect(frame.locator(".summary-row")).toHaveText(["締め切り付けない", "件数保留推奨: 20件", "分類仕事", "補足保留推奨: なし"])
    await frame.getByRole("button", { name: "変更して送り直す" }).click()
    await expect(hold(frame, "件数")).toBeChecked()
    await expect(frame.getByRole("textbox", { name: "補足" })).toHaveValue("")
    await expect(frame.locator(".status")).toHaveText("変更はまだありません")
  })
})
