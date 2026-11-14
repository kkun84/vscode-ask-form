import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Result } from "effect"
import { changedFields, computeValues, initialValues, outcomeFor, resendMessage } from "../../src/core/form.ts"
import { checkValues } from "../../src/core/validate.ts"
import { canonicalJson, stableHash } from "../../src/core/hash.ts"
import { messages } from "../../src/core/messages.ts"
import { eventSpec } from "../fixtures/event.ts"
import { compiled, problems } from "../support/compile.ts"

const withFields = (fields: ReadonlyArray<unknown>, computed: ReadonlyArray<unknown> = []) => ({
  title: "t",
  fields,
  computed
})

describe("DES-SPEC-001 設計図の読み取り", () => {
  it("DES-SPEC-001 正しい設計図を読み取り、未知のキーを捨てる", () => {
    const form = compiled({ ...eventSpec, unknownKey: 1 })
    assert.equal(form.spec.fields.length, 7)
    assert.equal("unknownKey" in form.spec, false)
  })

  it("DES-SPEC-001 型の誤りを場所つきで返す", () => {
    const [message] = problems({ title: "", fields: [] })
    assert.match(message ?? "", /title/)
    assert.match(message ?? "", /fields/)
  })

  it("DES-SPEC-001 重複したidを指摘する", () => {
    const found = problems(withFields([{ type: "toggle", id: "a", label: "A" }], [{ id: "a", label: "A", expression: "1" }]))
    assert.ok(found.some((p) => p.includes("「a」が重複")))
  })

  it("DES-SPEC-001 数値の範囲の誤りを指摘する", () => {
    assert.ok(problems(withFields([{ type: "number", id: "n", label: "N", min: 5, max: 5 }])).some((p) => p.includes("max以上")))
    assert.ok(problems(withFields([{ type: "number", id: "n", label: "N", min: 0, max: 5, default: 9 }])).some((p) => p.includes("範囲外")))
  })

  it("DES-SPEC-001 選択肢の既定値の誤りを指摘する", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" }
    ]
    assert.ok(
      problems(withFields([{ type: "choice", id: "c", label: "C", options, default: "z" }])).some((p) =>
        p.includes("「z」が選択肢にありません")
      )
    )
    assert.ok(
      problems(withFields([{ type: "choice", id: "c", label: "C", options, default: "a", multiple: true }])).some((p) => p.includes("配列"))
    )
    assert.ok(
      problems(withFields([{ type: "choice", id: "c", label: "C", options: [options[0], options[0]] }])).some((p) =>
        p.includes("valueが重複")
      )
    )
  })

  it("DES-SPEC-001 計算式の誤りと参照の誤りを指摘する", () => {
    const fields = [{ type: "number", id: "n", label: "N", min: 0, max: 1 }]
    assert.ok(problems(withFields(fields, [{ id: "x", label: "X", expression: "n +" }])).some((p) => p.includes("4文字目")))
    assert.ok(
      problems(
        withFields(fields, [
          { id: "x", label: "X", expression: "y" },
          { id: "y", label: "Y", expression: "n" }
        ])
      ).some((p) => p.includes("「y」を参照"))
    )
  })
})

describe("DES-SPEC-002 正規化と鍵", () => {
  it("DES-SPEC-002 キーの順序に関係なく同じ鍵になる", () => {
    const reordered = JSON.parse(JSON.stringify(eventSpec, Object.keys(eventSpec).toReversed()))
    assert.equal(compiled(eventSpec).key, compiled({ ...reordered, ...eventSpec }).key)
    assert.equal(stableHash({ b: 1, a: [1, { d: 2, c: 3 }] }), stableHash({ a: [1, { c: 3, d: 2 }], b: 1 }))
    assert.equal(canonicalJson({ b: 1, a: undefined, c: [] }), '{"b":1,"c":[]}')
  })

  it("DES-SPEC-002 内容が違えば鍵も違い、鍵は16桁の16進数", () => {
    const a = compiled(eventSpec).key
    const b = compiled({ ...eventSpec, title: "別のフォーム" }).key
    assert.notEqual(a, b)
    assert.match(a, /^[0-9a-f]{16}$/)
  })
})

describe("DES-FORM-001 初期値", () => {
  it("DES-FORM-001 defaultを初期値とし、ないときは種類ごとの既定にする", () => {
    assert.deepEqual(initialValues(compiled(eventSpec).spec), {
      name: "技術交流会 2026",
      format: "meetup",
      attendees: 120,
      price: 2000,
      stream: true,
      extras: ["sticker"],
      venue: 140000
    })
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" }
    ]
    assert.deepEqual(
      initialValues(
        compiled(
          withFields([
            { type: "text", id: "t", label: "T" },
            { type: "number", id: "n", label: "N", min: 3, max: 9 },
            { type: "choice", id: "c", label: "C", options },
            { type: "choice", id: "m", label: "M", options, multiple: true },
            { type: "toggle", id: "g", label: "G" }
          ])
        ).spec
      ),
      { t: "", n: 3, c: "a", m: [], g: false }
    )
  })
})

describe("DES-FORM-002 計算結果の順序", () => {
  it("DES-FORM-002 書かれた順に評価し、前の結果を後で使う", () => {
    const form = compiled(eventSpec)
    assert.deepEqual(computeValues(form, initialValues(form.spec)), { cost: 170000, profit: 70000, breakEven: 85 })
  })

  it("DES-FORM-002 複数選択は選んだ数として、評価できない結果はnullとして扱う", () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" }
    ]
    const form = compiled(
      withFields(
        [{ type: "choice", id: "m", label: "M", options, multiple: true, default: ["a", "b"] }],
        [
          { id: "count", label: "数", expression: "m" },
          { id: "bad", label: "誤", expression: "count / 0" }
        ]
      )
    )
    assert.deepEqual(computeValues(form, initialValues(form.spec)), { count: 2, bad: null })
  })
})

describe("DES-FORM-003 差分", () => {
  it("DES-FORM-003 異なる項目を設計図の順で返し、複数選択の順序は無視する", () => {
    const form = compiled(eventSpec)
    const before = initialValues(form.spec)
    assert.deepEqual(changedFields(form.spec, before, { ...before, extras: ["sticker"] }), [])
    assert.deepEqual(changedFields(form.spec, before, { ...before, venue: 1, price: 2500, extras: ["tshirt", "sticker"] }), [
      "price",
      "extras",
      "venue"
    ])
    assert.deepEqual(changedFields(form.spec, { ...before, extras: ["a", "b"] }, { ...before, extras: ["b", "a"] }), [])
  })

  it("DES-FORM-003 回答ではAIの案から変えた項目を changedByUser にする", () => {
    const form = compiled(eventSpec)
    const values = { ...initialValues(form.spec), price: 2500 }
    const outcome = outcomeFor(form, "submit", values)
    assert.equal(outcome.status, "submitted")
    if (outcome.status === "submitted") {
      assert.deepEqual(outcome.changedByUser, ["price"])
      assert.equal(outcome.computed["profit"], 130000)
    }
    const delegated = outcomeFor(form, "delegate", values)
    assert.equal(delegated.status, "delegated")
    if (delegated.status === "delegated") {
      assert.equal(delegated.values["price"], 2000)
    }
    assert.deepEqual(outcomeFor(form, "chat", values), { status: "answer_in_chat" })
  })
})

describe("DES-FORM-004 値の検査", () => {
  it("DES-FORM-004 正しい値を受け付ける", () => {
    const form = compiled(eventSpec)
    const result = checkValues(form.spec, { ...initialValues(form.spec), extra: 1 })
    assert.ok(Result.isSuccess(result))
    assert.equal("extra" in result.success, false)
  })

  it("DES-FORM-004 種類、範囲、選択肢に合わない値を指摘する", () => {
    const form = compiled(eventSpec)
    const base = initialValues(form.spec)
    const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ ...base, name: 1 }, "name"],
      [{ ...base, attendees: 999 }, "attendees"],
      [{ ...base, price: "2000" }, "price"],
      [{ ...base, format: "party" }, "format"],
      [{ ...base, extras: ["sticker", "mug"] }, "extras"],
      [{ ...base, stream: "yes" }, "stream"]
    ]
    for (const [values, id] of cases) {
      const result = checkValues(form.spec, values)
      assert.ok(Result.isFailure(result), id)
      assert.ok(
        result.failure.some((p) => p.includes(`「${id}」`)),
        id
      )
    }
    assert.ok(Result.isFailure(checkValues(form.spec, [])))
  })
})

describe("DES-FORM-005 送り直しの文章", () => {
  it("DES-FORM-005 差分を表示名で並べた文章を作る", () => {
    const form = compiled(eventSpec)
    const before = initialValues(form.spec)
    const after = { ...before, price: 2500, stream: false, format: "talk", extras: ["sticker", "tshirt"] }
    assert.equal(
      resendMessage(form.spec, before, after, messages("ja")),
      "「交流会の条件」で形式を勉強会、参加費を¥2,500、ライブ配信をオフ、配布物をステッカー、Tシャツに変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(form.spec, before, { ...before, price: 2500 }, messages("en")),
      'In "交流会の条件", I changed 参加費 to ¥2,500. Please apply it and continue.'
    )
  })

  it("DES-FORM-005 差分がなければ文章を作らない", () => {
    const form = compiled(eventSpec)
    const values = initialValues(form.spec)
    assert.equal(resendMessage(form.spec, values, values, messages("ja")), undefined)
  })
})
