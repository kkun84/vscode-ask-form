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

interface OutcomeLike {
  readonly status: string
  readonly values?: Record<string, unknown>
  readonly changedByUser?: ReadonlyArray<string>
}

const selectStorage = async (frame: Frame, name: string) => {
  await frame.getByRole("radio", { name }).check()
}

const axeViolations = async (frame: Frame): Promise<ReadonlyArray<string>> => {
  await expect.poll(() => frame.evaluate(() => document.getAnimations().length)).toBe(0)
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
    await expect(frame.getByText("答えるか、コメントを書いてください: 色")).toBeVisible()
    await expect(frame.getByRole("radio", { name: "赤" })).toBeFocused()
    await expect(frame.getByRole("radiogroup", { name: "色" })).toHaveAttribute("aria-invalid", "true")
    expect(await recorded(page, "outcomes")).toHaveLength(0)
  })

  test("SPEC-UI-001 advancedの項目は閉じた「詳細」の中にある", async ({ page }) => {
    const frame = await open(page)
    const details = frame.locator("ui-collapsible.advanced")
    const trigger = details.getByRole("button", { name: "詳細" })
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(details.getByRole("group", { name: "配布物" })).toBeHidden()
    await trigger.click()
    await expect(details.getByRole("group", { name: "配布物" })).toBeVisible()
  })
})

test.describe("SPEC-UI-001 数値と文字列の入力", () => {
  test("SPEC-UI-001 数値は増減ボタンとShift付きの矢印キーで変えられ、スピンボタンとして読める", async ({ page }) => {
    const frame = await open(page)
    const price = frame.getByRole("spinbutton", { name: "参加費" })
    await frame.getByRole("button", { name: "参加費を増やす" }).click()
    await expect(price).toHaveValue("2,500")
    await expect(price).toHaveAttribute("aria-valuenow", "2500")
    await frame.getByRole("button", { name: "参加費を減らす" }).click()
    await frame.getByRole("button", { name: "参加費を減らす" }).click()
    await expect(price).toHaveValue("1,500")
    const attendees = frame.getByRole("spinbutton", { name: "参加者数" })
    await attendees.press("Shift+ArrowUp")
    await expect(attendees).toHaveValue("150")
    await send(frame)
    expect((await singleOutcome(page))?.values).toMatchObject({ price: 1500, attendees: 150 })
  })

  test("SPEC-UI-001 1行の文字列はボタンで空にでき、空欄という答えになる", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "イベント名を空にする" }).click()
    await expect(frame.getByRole("textbox", { name: "イベント名" })).toHaveValue("")
    await send(frame)
    expect((await singleOutcome(page))?.values).toMatchObject({ name: "" })
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
  })
})

test.describe("SPEC-UI-006 受け付けられない回答", () => {
  test("SPEC-UI-006 回答が受け付けられないと、ホストが返した誤りを示し、回答の操作を残す", async ({ page }) => {
    const frame = await open(page)
    await page.evaluate(() => (window as unknown as { harness: { cancel: () => void } }).harness.cancel())
    await send(frame)
    const status = frame.locator(".status")
    await expect(status).toHaveText(/^expired: /)
    await expect(status).toHaveClass(/error/)
    await expect(frame.locator("footer").getByRole("button")).toHaveText(["キャンセル", "送信"])
    await expect(frame.getByRole("button", { name: "送信", exact: true })).toBeEnabled()
    expect(await recorded(page, "outcomes")).toHaveLength(0)
  })
})

test("SPEC-UI-010 別のフレームから偽の設計図や表示設定が届いても、元のフォームで回答を続けられる", async ({ page }) => {
  const frame = await open(page)
  await page.evaluate(() => {
    const sibling = document.createElement("iframe")
    sibling.name = "untrusted"
    document.body.append(sibling)
  })
  const sibling = page.frame("untrusted")
  expect(sibling).not.toBeNull()
  await sibling?.evaluate((spec) => {
    const form = window.parent.document.querySelector<HTMLIFrameElement>("#form")?.contentWindow
    form?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { ...spec, title: "偽の質問" } } }, "*")
    form?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { locale: "en" } }, "*")
  }, eventSpec)
  await frame.evaluate(
    () =>
      new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
  )
  await expect(frame.getByRole("heading", { level: 1 })).toHaveText(eventSpec.title)
  await expect(frame.locator("footer").getByRole("button")).toHaveText(["キャンセル", "送信"])
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
      await frame.getByRole("button", { name: "詳細", exact: true }).click()
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
    await expect(port).toHaveValue("3,000")
    expect(await axeViolations(frame)).toEqual([])
  })

  test("SPEC-UI-011 回答には選んだ選択肢の項目だけを含める", async ({ page }) => {
    const frame = await openStorage(page)
    await frame.getByRole("radio", { name: "サーバー" }).check()
    await frame.getByRole("spinbutton", { name: "ポート" }).fill("3000")
    await frame.getByRole("button", { name: "送信", exact: true }).click()
    const outcome = await singleOutcome(page)
    expect(outcome?.values).toEqual({ name: "my-todo", storage: "server", port: 3000, auth: "no" })
    expect(outcome?.changedByUser).toEqual(["storage", "port"])
  })
})

test.describe("SPEC-UI-009 表示の言語", () => {
  test("SPEC-UI-009 英語のロケールでは英語で表示する", async ({ page }) => {
    const frame = await open(page, { context: { locale: "en-US" } })
    await expect(frame.locator("footer").getByRole("button")).toHaveText(["Cancel", "Send"])
    await expect(frame.getByRole("button", { name: "Clear selection for 形式", exact: true })).toBeVisible()
    await expect(frame.getByRole("button", { name: "Comment on 参加費", exact: true })).toBeVisible()
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

const unselect = (frame: Frame, question: string) => frame.getByRole("button", { name: `${question}の選択を解除`, exact: true })

const clearNumber = async (frame: Frame, question: string) => {
  const input = frame.getByRole("spinbutton", { name: question })
  await input.fill("")
  await input.press("Tab")
}

const comment = (frame: Frame, question: string) => frame.getByRole("textbox", { name: `${question}へのコメント` })

const openComment = (frame: Frame, question: string) => frame.getByRole("button", { name: `${question}へのコメント`, exact: true }).click()

const writeComment = async (frame: Frame, question: string, text: string) => {
  if (!(await comment(frame, question).isVisible())) {
    await openComment(frame, question)
  }
  await comment(frame, question).fill(text)
}

const openAnswered = async (page: Page): Promise<Frame> => {
  const frame = await open(page, { args: holdSpec })
  await frame.getByRole("radio", { name: "付けない" }).check()
  return frame
}

const submitChecked = async (page: Page, frame: Frame): Promise<Answered> => {
  expect(await axeViolations(frame)).toEqual([])
  await send(frame)
  return (await singleOutcome(page)) as Answered
}

interface Answered extends OutcomeLike {
  readonly held?: ReadonlyArray<string>
  readonly comments?: Readonly<Record<string, string>>
  readonly heldForm?: { readonly title: string; readonly fields: ReadonlyArray<{ readonly id: string }> }
}

const send = (frame: Frame) => frame.getByRole("button", { name: "送信", exact: true }).click()

const note = (frame: Frame) => frame.getByRole("textbox", { name: "補足を書く" })

const openWithNote = async (page: Page): Promise<Frame> => {
  const frame = await open(page)
  await frame.getByRole("button", { name: "補足を書く" }).click()
  await note(frame).fill("会場は未定です")
  return frame
}

test.describe("SPEC-UI-013 補足の入力", () => {
  test("SPEC-UI-013 画面が描き直されても、書きかけの補足と開いた状態を保つ", async ({ page }) => {
    const frame = await openWithNote(page)
    await page.evaluate(() => {
      document
        .querySelector<HTMLIFrameElement>("#form")
        ?.contentWindow?.postMessage({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } }, "*")
    })
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "light")
    await expect(frame.getByRole("button", { name: "補足を書く" })).toHaveAttribute("aria-expanded", "true")
    await expect(note(frame)).toHaveValue("会場は未定です")
  })

  test("SPEC-UI-013 2000文字を超える入力は、貼り付けても画面で切り詰める", async ({ page }) => {
    const frame = await open(page)
    await frame.getByRole("button", { name: "補足を書く" }).click()
    await note(frame).evaluate((element: HTMLTextAreaElement) => {
      element.value = `${"x".repeat(1999)}😀y`
      element.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await expect(note(frame)).toHaveValue("x".repeat(1999))
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly note?: string }
    expect(outcome.note).toBe("x".repeat(1999))
  })
})

test.describe("SPEC-UI-013 補足", () => {
  test("SPEC-UI-013 閉じた補足を開いて書くと、前後の空白を除いて回答と一緒に届く", async ({ page }) => {
    const frame = await open(page)
    await expect(note(frame)).toBeHidden()
    await frame.getByRole("button", { name: "補足を書く" }).click()
    await expect(frame.locator("ui-collapsible.note")).toContainText("選択肢にない答えや、Copilotに伝えたいことを書けます")
    await expect(note(frame)).toHaveAttribute("maxlength", "2000")
    await note(frame).fill(" 会場は未定です\n参加費は任せます ")
    expect(await axeViolations(frame)).toEqual([])
    await note(frame).press("ControlOrMeta+Enter")
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly note?: string }
    expect(outcome.note).toBe("会場は未定です\n参加費は任せます")
  })

  test("SPEC-UI-013 補足を書いても、未回答の質問が残る間は送信できない", async ({ page }) => {
    const frame = await open(page, {
      args: {
        title: "t",
        fields: [{ type: "choice", id: "c", label: "方式", options: ["a", "b"].map((value) => ({ value, label: value })) }]
      }
    })
    await frame.getByRole("button", { name: "補足を書く" }).click()
    await note(frame).fill("どちらでもない方式にしたい")
    await send(frame)
    await expect(frame.locator(".status")).toHaveText("答えるか、コメントを書いてください: 方式")
    await expect(note(frame)).toHaveValue("どちらでもない方式にしたい")
    expect(await recorded(page, "outcomes")).toHaveLength(0)
  })

  test("SPEC-UI-013 補足を書かなければnoteを渡さない", async ({ page }) => {
    const frame = await open(page)
    await send(frame)
    const outcome = (await singleOutcome(page)) as OutcomeLike & { readonly note?: string }
    expect("note" in outcome).toBe(false)
  })
})

test.describe("SPEC-UI-012 値のない回答", () => {
  test("SPEC-UI-012 値を入れずにコメントを書いた質問は、値を届けずにheldとコメントで伝わる", async ({ page }) => {
    const frame = await open(page, { args: holdSpec })
    await expect(unselect(frame, "締め切り")).toBeHidden()
    await writeComment(frame, "締め切り", "あとで決める。")
    await clearNumber(frame, "件数")
    await writeComment(frame, "件数", "どれでもよい。")
    await expect(frame.locator(".metric-value")).toHaveText("—")
    const outcome = await submitChecked(page, frame)
    expect(outcome.values).toEqual({ tags: ["work"], memo: "なし" })
    expect(outcome.held).toEqual(["due", "size"])
    expect(outcome.heldForm?.fields.map((field) => field.id)).toEqual(["due", "size"])
    expect(outcome.comments).toEqual({ due: "あとで決める。", size: "どれでもよい。" })
    expect(outcome.changedByUser).toEqual([])
  })

  test("SPEC-UI-012 単一選択は選択肢の下の「選択を解除」で選択を外し、コメント欄を開く", async ({ page }) => {
    const frame = await openStorage(page)
    await expect(unselect(frame, "保存先")).toBeVisible()
    await unselect(frame, "保存先").click()
    await expect(frame.getByRole("radio", { name: "ブラウザ" })).not.toBeChecked()
    await expect(unselect(frame, "保存先")).toBeHidden()
    await expect(frame.getByRole("group", { name: "保存方式" })).toBeHidden()
    await expect(comment(frame, "保存先")).toBeFocused()
    await comment(frame, "保存先").fill("チームで決める")
    await send(frame)
    const outcome = (await singleOutcome(page)) as Answered
    expect(outcome.values).toEqual({ name: "my-todo" })
    expect(outcome.held).toEqual(["storage"])
    expect(outcome.comments).toEqual({ storage: "チームで決める" })
  })

  test("SPEC-UI-012 値を外してもコメントがなければ未回答として送らない", async ({ page }) => {
    const frame = await openAnswered(page)
    await clearNumber(frame, "件数")
    await send(frame)
    await expect(frame.locator(".status")).toHaveText("答えるか、コメントを書いてください: 件数")
    expect(await recorded(page, "outcomes")).toHaveLength(0)
  })

  test("SPEC-UI-012 値を外した後に値を入れると、値のある回答に戻る", async ({ page }) => {
    const frame = await openAnswered(page)
    await clearNumber(frame, "件数")
    await writeComment(frame, "件数", "未定")
    await frame.getByRole("spinbutton", { name: "件数" }).fill("50")
    await send(frame)
    const outcome = (await singleOutcome(page)) as Answered
    expect(outcome.values).toEqual({ due: "no", size: 50, tags: ["work"], memo: "なし" })
    expect(outcome.held).toEqual([])
    expect(outcome.comments).toEqual({ size: "未定" })
  })

  test("SPEC-UI-012 手で空欄にした文字列は、空欄という答えとして届く", async ({ page }) => {
    const frame = await openAnswered(page)
    await frame.getByRole("textbox", { name: "補足", exact: true }).fill("")
    await send(frame)
    const outcome = (await singleOutcome(page)) as Answered
    expect(outcome.values?.["memo"]).toBe("")
    expect(outcome.held).toEqual([])
  })
})

test.describe("SPEC-UI-014 項目ごとのコメント", () => {
  test("SPEC-UI-014 値のある質問にもコメントを書け、前後の空白を除いて値と一緒に届く", async ({ page }) => {
    const frame = await openAnswered(page)
    await expect(comment(frame, "件数")).toBeHidden()
    await openComment(frame, "件数")
    await expect(comment(frame, "件数")).toBeFocused()
    await expect(comment(frame, "件数")).toHaveAttribute("maxlength", "500")
    await comment(frame, "件数").fill(" 多めに ")
    const outcome = await submitChecked(page, frame)
    expect(outcome.values?.["size"]).toBe(20)
    expect(outcome.comments).toEqual({ size: "多めに" })
  })

  test("SPEC-UI-014 コメントは畳んで始め、文字のないアイコンのボタンで開閉し、書いたコメントは畳んでも残る", async ({ page }) => {
    const frame = await openAnswered(page)
    const button = frame.getByRole("button", { name: "件数へのコメント", exact: true })
    await expect(button).toHaveText("")
    await expect(button).toHaveAttribute("aria-expanded", "false")
    await expect(comment(frame, "件数")).toBeHidden()
    await expect(presets(frame, "件数")).toHaveCount(0)
    await button.click()
    await expect(button).toHaveAttribute("aria-expanded", "true")
    await expect(presets(frame, "件数")).toHaveCount(3)
    await comment(frame, "件数").fill("多めに")
    await button.click()
    await expect(comment(frame, "件数")).toBeHidden()
    await expect(button).toHaveClass(/has-comment/)
    const outcome = await submitChecked(page, frame)
    expect(outcome.comments).toEqual({ size: "多めに" })
  })

  test("SPEC-UI-014 値のない質問では、コメント欄に答えない理由を促す", async ({ page }) => {
    const frame = await open(page, { args: holdSpec })
    await openComment(frame, "件数")
    await expect(comment(frame, "件数")).toHaveAttribute("placeholder", /この質問について/)
    await clearNumber(frame, "件数")
    await expect(comment(frame, "件数")).toHaveAttribute("placeholder", /答えないときは/)
  })
})

const presets = (frame: Frame, question: string) =>
  frame.getByRole("group", { name: `${question}へのコメントの定型文` }).getByRole("button")

test.describe("SPEC-UI-014 コメントの定型文", () => {
  test("SPEC-UI-014 値を外して定型文を押すだけで、値なしの回答を作れる", async ({ page }) => {
    const frame = await openAnswered(page)
    await clearNumber(frame, "件数")
    await openComment(frame, "件数")
    await expect(presets(frame, "件数")).toHaveText([
      "他の要件を先に決める。",
      "この質問の意味がわからない。説明が足りない。",
      "インターネットで調査した上でもう一度検討しよう。"
    ])
    await presets(frame, "件数").filter({ hasText: "他の要件を先に決める。" }).click()
    await expect(comment(frame, "件数")).toHaveValue("他の要件を先に決める。")
    await expect(comment(frame, "件数")).toBeFocused()
    await presets(frame, "件数").filter({ hasText: "インターネットで調査した上でもう一度検討しよう。" }).click()
    await expect(comment(frame, "件数")).toHaveValue("他の要件を先に決める。インターネットで調査した上でもう一度検討しよう。")
    const outcome = await submitChecked(page, frame)
    expect(outcome.held).toEqual(["size"])
    expect(outcome.comments).toEqual({ size: "他の要件を先に決める。インターネットで調査した上でもう一度検討しよう。" })
  })

  test("SPEC-UI-014 設定した定型文に置き換える", async ({ page }) => {
    const custom = await open(page, { args: holdSpec, commentPresets: ["予算次第", "任せる"] })
    await openComment(custom, "件数")
    await expect(presets(custom, "件数")).toHaveText(["予算次第", "任せる"])
  })

  test("SPEC-UI-014 定型文を空にする設定なら定型文を出さない", async ({ page }) => {
    const none = await open(page, { args: holdSpec, commentPresets: [] })
    await openComment(none, "件数")
    await expect(comment(none, "件数")).toBeVisible()
    await expect(none.getByRole("group", { name: "件数へのコメントの定型文" })).toHaveCount(0)
  })
})

const rankingArgs = {
  title: "作業の順番",
  fields: [
    {
      type: "ranking",
      id: "order",
      label: "優先順位",
      default: ["auth", "api"],
      reason: "依存の順",
      options: [
        { value: "ui", label: "画面" },
        { value: "api", label: "API", description: "外部連携" },
        { value: "auth", label: "ログイン" },
        { value: "docs", label: "文書" }
      ]
    },
    {
      type: "ranking",
      id: "fruit",
      label: "上位2つ",
      max: 2,
      options: [
        { value: "a", label: "りんご" },
        { value: "b", label: "みかん" },
        { value: "c", label: "ぶどう" }
      ]
    }
  ]
}

const placed = (frame: Frame, list: string) =>
  frame.getByRole("list", { name: list }).getByRole("listitem").locator(".option-head").allTextContents()

test.describe("SPEC-UI-015 並べ替え", () => {
  test("SPEC-UI-015 推奨を順位に入れて始め、候補を押すと末尾に入り、×で元の位置に戻り、推奨に戻せる", async ({ page }) => {
    const frame = await open(page, { args: rankingArgs })
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["ログイン", "API"])
    expect(await placed(frame, "優先順位の候補")).toEqual(["画面", "文書"])
    await expect(frame.locator(".rec", { hasText: "依存の順" })).toContainText("ログイン → API")
    await frame.getByRole("listitem", { name: "文書" }).click()
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["ログイン", "API", "文書"])
    await frame.getByRole("button", { name: "APIを候補に戻す" }).click()
    await expect.poll(() => placed(frame, "優先順位の候補")).toEqual(["画面", "API"])
    await frame.getByRole("button", { name: "推奨に戻す" }).click()
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["ログイン", "API"])
  })

  test("SPEC-UI-015 キーボードで持ち上げて動かし、Escで戻し、Deleteで候補に戻す。操作方法は読み上げにだけ渡す", async ({ page }) => {
    const frame = await open(page, { args: rankingArgs })
    const api = frame.getByRole("listitem", { name: "API" })
    await expect(api).toHaveAccessibleDescription(/SpaceかEnterで持ち上げ/)
    await expect(frame.getByText(/SpaceかEnterで持ち上げ/).first()).toBeHidden()
    await api.focus()
    await api.press("Space")
    await api.press("ArrowUp")
    await api.press("Space")
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["API", "ログイン"])
    await api.press("Enter")
    await api.press("ArrowDown")
    await api.press("Escape")
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["API", "ログイン"])
    await frame.getByRole("listitem", { name: "ログイン" }).press("Delete")
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["API"])
  })

  test("SPEC-UI-015 推奨のない並べ替えは空で始めて未回答になり、上限まで入れて送ると順位だけが届く", async ({ page }) => {
    const frame = await open(page, { args: rankingArgs })
    await expect(frame.getByText("候補を押すと、ここに順に入ります").last()).toBeVisible()
    await send(frame)
    await expect(frame.locator(".status")).toHaveText("答えるか、コメントを書いてください: 上位2つ")
    for (const name of ["みかん", "りんご", "ぶどう"]) {
      await frame.getByRole("listitem", { name }).click()
    }
    await expect.poll(() => placed(frame, "上位2つの順位")).toEqual(["みかん", "りんご"])
    await frame.getByRole("listitem", { name: "文書" }).dragTo(frame.getByRole("listitem", { name: "ログイン" }))
    await expect.poll(() => placed(frame, "優先順位の順位")).toEqual(["文書", "ログイン", "API"])
    expect(await axeViolations(frame)).toEqual([])
    await send(frame)
    const outcome = await singleOutcome(page)
    expect(outcome?.values).toEqual({ order: ["docs", "auth", "api"], fruit: ["b", "a"] })
    expect(outcome?.changedByUser).toEqual(["order", "fruit"])
  })
})
