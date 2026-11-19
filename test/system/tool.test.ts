import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { Effect, Fiber } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { stableHash } from "../../src/core/hash.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { structured, text, withHarness, type Harness, type ToolResult } from "../support/host.ts"

const form = eventForm

const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => reverseKeys(item))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toReversed()
        .map(([key, item]) => [key, reverseKeys(item)])
    )
  }
  return value
}

const ask = (h: Harness, spec: unknown = eventSpec, count = 1) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(h.call("ask_form", spec as Record<string, unknown>))
    yield* h.waitUntil(count)
    return fiber
  })

const expectError = (call: Effect.Effect<ToolResult>, pattern: RegExp) =>
  Effect.map(call, (result) => {
    assert.equal(result.isError, true)
    assert.match(text(result), pattern)
  })

const expectExpired = (h: Harness, formKey: string) => expectError(h.call("form_answer", { formKey, action: "chat" }), /expired/)

const statusOf = (h: Harness) => Effect.map(h.call("form_status", { formKey: form.key }), (result) => structured(result)["status"])

const answered = (h: Harness, action: "submit" | "chat") =>
  Effect.gen(function* () {
    const fiber = yield* ask(h)
    yield* h.call("form_answer", { formKey: form.key, action, ...(action === "submit" ? { values: initialValues(form.spec) } : {}) })
    return yield* Fiber.join(fiber)
  })

describe("SPEC-TOOL-003 回答を待つ", () => {
  it("SPEC-TOOL-003 回答が届くまで待ち、回答を文章とJSONで返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        assert.equal(fiber.pollUnsafe(), undefined)
        const values = { ...initialValues(form.spec), price: 2500 }
        const answer = yield* h.call("form_answer", { formKey: form.key, action: "submit", values })
        assert.equal(answer.isError, false)
        const result = yield* Fiber.join(fiber)
        const outcome = structured(result)
        assert.equal(outcome["status"], "submitted")
        assert.deepEqual(outcome["changedByUser"], ["price"])
        assert.deepEqual(outcome["values"], values)
        assert.deepEqual(outcome["computed"], { cost: 170000, profit: 130000, breakEven: 68 })
        assert.match(text(result), /"status":"submitted"/)
      })
    ))

  it("SPEC-TOOL-003 値のない項目はheldとheldFormで返し、値のある項目のコメントも添える", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        const { price: _price, format: _format, ...values } = initialValues(form.spec)
        yield* h.call("form_answer", {
          formKey: form.key,
          action: "submit",
          values,
          held: ["format", "price"],
          comments: { price: " 予算が決まったら ", format: "任せる", name: "仮の名前" }
        })
        const result = yield* Fiber.join(fiber)
        const outcome = structured(result)
        assert.deepEqual(outcome["values"], values)
        assert.deepEqual(outcome["held"], ["format", "price"])
        assert.deepEqual(outcome["comments"], { name: "仮の名前", format: "任せる", price: "予算が決まったら" })
        assert.deepEqual(outcome["heldForm"], {
          title: eventSpec.title,
          fields: form.spec.fields.filter((field) => field.id === "format" || field.id === "price")
        })
        assert.deepEqual(outcome["changedByUser"], [])
        assert.deepEqual(outcome["computed"], { cost: 170000, profit: null, breakEven: null })
        assert.match(text(result), /follow each for its field.*let you decide.*does not matter.*heldForm/)
      })
    ))

  it("SPEC-TOOL-003 補足は前後の空白を除いてnoteで返し、空の補足は返さない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const values = initialValues(form.spec)
        const noted = yield* ask(h)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values, note: "  会場は未定です\n" })
        const result = yield* Fiber.join(noted)
        assert.equal(structured(result)["note"], "会場は未定です")
        assert.match(text(result), /If note is present.*follow it over any value it contradicts.*answers a held field/)
        const plain = yield* ask(h)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values, note: " \n" })
        assert.equal("note" in structured(yield* Fiber.join(plain)), false)
      })
    ))

  it("SPEC-TOOL-003 チャットで答える場合は作業を区切る指示を返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const result = yield* answered(h, "chat")
        assert.equal(structured(result)["status"], "answer_in_chat")
        assert.match(text(result), /End your turn/)
      })
    ))
})

describe("SPEC-TOOL-004 設計図の誤り", () => {
  it("SPEC-TOOL-004 誤った設計図は待たずに問題の一覧を返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* expectError(
          h.call("ask_form", { title: "t", fields: [{ type: "number", id: "n", label: "N", min: 9, max: 1 }] }),
          /minがmax以上/
        )
        yield* h.waitUntil(0)
      })
    ))

  it("SPEC-TOOL-004 型の合わない設計図も誤りとして返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const result = yield* h.call("ask_form", { title: "t", fields: "none" })
        assert.equal(result.isError, true)
      })
    ))
})

describe("SPEC-TOOL-005 画面からの回答", () => {
  it("SPEC-TOOL-005 値もコメントもない項目、値のある項目のheld、文字列でないコメントと補足、長すぎる補足を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* ask(h)
        const { price: _price, ...values } = initialValues(form.spec)
        yield* expectError(h.call("form_answer", { formKey: form.key, action: "submit", values, held: ["price"] }), /price.*コメントが必要/)
        yield* expectError(
          h.call("form_answer", { formKey: form.key, action: "submit", values: initialValues(form.spec), held: ["price"] }),
          /price.*できません/
        )
        yield* expectError(
          h.call("form_answer", { formKey: form.key, action: "submit", values: initialValues(form.spec), comments: { price: 1 } }),
          /price.*コメント/
        )
        const noted = { formKey: form.key, action: "submit", values: initialValues(form.spec) }
        yield* expectError(h.call("form_answer", { ...noted, note: 1 }), /note/)
        yield* expectError(h.call("form_answer", { ...noted, note: "x".repeat(2001) }), /note/)
        assert.equal(yield* statusOf(h), "pending")
      })
    ))

  it("SPEC-TOOL-005 設計図に合わない値は誤りとして返し、待機は続く", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        const bad = yield* h.call("form_answer", {
          formKey: form.key,
          action: "submit",
          values: { ...initialValues(form.spec), attendees: 9999 }
        })
        assert.equal(bad.isError, true)
        assert.match(text(bad), /attendees/)
        assert.equal(fiber.pollUnsafe(), undefined)
        yield* h.call("form_answer", { formKey: form.key, action: "chat" })
        yield* Fiber.join(fiber)
      })
    ))

  it("SPEC-TOOL-005 別のフォームの鍵と、回答済みのフォームへの回答は受け付けない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* expectExpired(h, "0000000000000000")
        yield* answered(h, "chat")
        yield* expectExpired(h, form.key)
      })
    ))
})

describe("SPEC-TOOL-006 フォームの鍵", () => {
  it("SPEC-TOOL-006 画面が受け取った引数から計算した鍵で回答できる", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const args = { computed: eventSpec.computed, fields: eventSpec.fields, title: eventSpec.title, extra: { nested: true } }
        const fiber = yield* ask(h, args)
        const reordered = reverseKeys(args)
        assert.notEqual(stableHash(args), form.key)
        const answer = yield* h.call("form_answer", { formKey: stableHash(reordered), action: "chat" })
        assert.equal(answer.isError, false)
        yield* Fiber.join(fiber)
      })
    ))
})

describe("SPEC-TOOL-007 中断", () => {
  it("SPEC-TOOL-007 取り消された質問は中断を示し、以後の回答は受け付けない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* ask(h)
        yield* Fiber.interrupt(fiber)
        yield* h.waitUntil(0)
        assert.equal(yield* statusOf(h), "cancelled")
        yield* expectExpired(h, form.key)
      })
    ))

  it("SPEC-TOOL-007 取り消しは対象の質問だけを終わらせる", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const stopped = yield* ask(h)
        const otherSpec = { ...eventSpec, title: "Another question" }
        const other = yield* ask(h, otherSpec, 2)
        yield* Fiber.interrupt(stopped)
        yield* h.waitUntil(1)
        yield* h.call("form_answer", { formKey: stableHash(otherSpec), action: "chat" })
        assert.equal(structured(yield* Fiber.join(other))["status"], "answer_in_chat")
      })
    ))

  it("SPEC-TOOL-007 未知の鍵と回答済みの鍵は中断と区別する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(yield* statusOf(h), "unknown")
        yield* answered(h, "submit")
        assert.equal(yield* statusOf(h), "answered")
      })
    ))
})
