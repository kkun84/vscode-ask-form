import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Result } from "effect"
import { changedFields, commentPresetsFrom, computeValues, initialValues, outcomeFor, resendMessage } from "../../src/core/form.ts"
import { checkAnswer, checkValues } from "../../src/core/validate.ts"
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
    const found = problems(withFields([{ type: "text", id: "a", label: "A" }], [{ id: "a", label: "A", expression: "1" }]))
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

const describedOptions = (description: string) => [
  { value: "a", label: "A", description },
  { value: "b", label: "B" }
]

describe("DES-SPEC-001 文字数の目安と上限", () => {
  const shownTexts: ReadonlyArray<readonly [string, number, (text: string) => unknown]> = [
    ["設計図のtitle", 80, (text) => ({ ...withFields([{ type: "text", id: "a", label: "A" }]), title: text })],
    ["設計図のdescription", 300, (text) => ({ ...withFields([{ type: "text", id: "a", label: "A" }]), description: text })],
    ["項目のlabel", 60, (text) => withFields([{ type: "text", id: "a", label: text }])],
    ["項目のdescription", 120, (text) => withFields([{ type: "text", id: "a", label: "A", description: text }])],
    ["項目のreason", 60, (text) => withFields([{ type: "text", id: "a", label: "A", default: "d", reason: text }])],
    ["項目のreasonDetails", 300, (text) => withFields([{ type: "text", id: "a", label: "A", default: "d", reasonDetails: text }])],
    ["項目のplaceholder", 80, (text) => withFields([{ type: "text", id: "a", label: "A", placeholder: text }])],
    [
      "選択肢のlabel",
      60,
      (text) =>
        withFields([
          {
            type: "choice",
            id: "c",
            label: "C",
            options: [
              { value: "a", label: text },
              { value: "b", label: "B" }
            ]
          }
        ])
    ],
    ["選択肢のdescription", 60, (text) => withFields([{ type: "choice", id: "c", label: "C", options: describedOptions(text) }])],
    [
      "選択肢のdetails",
      300,
      (text) =>
        withFields([
          {
            type: "choice",
            id: "c",
            label: "C",
            options: [
              { value: "a", label: "A", details: text },
              { value: "b", label: "B" }
            ]
          }
        ])
    ],
    ["計算結果のlabel", 60, (text) => withFields([{ type: "text", id: "a", label: "A" }], [{ id: "x", label: text, expression: "1" }])]
  ]

  for (const [name, aim, build] of shownTexts) {
    it(`DES-SPEC-001 ${name}は目安の2倍の${aim * 2}文字まで読み取り、それを超えると誤りにする`, () => {
      compiled(build("x".repeat(aim * 2)))
      assert.equal(problems(build("x".repeat(aim * 2 + 1))).length, 1)
    })
  }

  it("DES-SPEC-001 id、選択肢のvalue、default、計算式、単位の上限は広げない", () => {
    const number = { type: "number", id: "n", label: "N", min: 0, max: 1 }
    const longValue = [
      { value: "v".repeat(61), label: "A" },
      { value: "b", label: "B" }
    ]
    for (const spec of [
      withFields([{ type: "text", id: "a".repeat(41), label: "A" }]),
      withFields([{ type: "text", id: "a", label: "A", default: "d".repeat(501) }]),
      withFields([{ type: "choice", id: "c", label: "C", options: longValue }]),
      withFields([{ ...number, prefix: "x".repeat(9) }]),
      withFields([{ ...number, suffix: "x".repeat(9) }]),
      withFields([number], [{ id: "x", label: "X", expression: `n${" + 0".repeat(75)}` }])
    ]) {
      assert.equal(problems(spec).length, 1)
    }
    compiled(withFields([number], [{ id: "x", label: "X", expression: `n${" + 0".repeat(74)}` }]))
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
  it("DES-FORM-001 defaultを初期値とし、ないときは文字を空、複数選択を空にし、単一選択と数値は未回答にする", () => {
    assert.deepEqual(initialValues(compiled(eventSpec).spec), {
      name: "技術交流会 2026",
      format: "meetup",
      attendees: 120,
      price: 2000,
      stream: "yes",
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
            { type: "choice", id: "m", label: "M", options, multiple: true }
          ])
        ).spec
      ),
      { t: "", m: [] }
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

  it("DES-FORM-003 回答では推奨から変えた項目を changedByUser にする", () => {
    const form = compiled(eventSpec)
    const values = { ...initialValues(form.spec), price: 2500 }
    const outcome = outcomeFor(form, "submit", { values })
    assert.equal(outcome.status, "submitted")
    if (outcome.status === "submitted") {
      assert.deepEqual(outcome.changedByUser, ["price"])
      assert.equal(outcome.computed["profit"], 130000)
    }
    assert.deepEqual(outcomeFor(form, "chat", { values }), { status: "answer_in_chat" })
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
      [{ ...base, stream: true }, "stream"]
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
    const after = { ...before, price: 2500, stream: "no", format: "talk", extras: ["sticker", "tshirt"] }
    assert.equal(
      resendMessage(form.spec, { values: before }, { values: after }, messages("ja")),
      "「交流会の条件」で形式を勉強会、参加費を¥2,500、ライブ配信をなし、配布物をステッカー、Tシャツに変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(form.spec, { values: before }, { values: { ...before, price: 2500 } }, messages("en")),
      'In "交流会の条件", I changed 参加費 to ¥2,500. Please apply it and continue.'
    )
  })

  it("DES-FORM-005 差分がなければ文章を作らない", () => {
    const form = compiled(eventSpec)
    const values = initialValues(form.spec)
    assert.equal(resendMessage(form.spec, { values }, { values }, messages("ja")), undefined)
  })
})

describe("DES-FORM-008 補足", () => {
  const form = compiled(withFields([{ type: "text", id: "name", label: "名前", default: "a" }]))
  const answer = (note?: unknown) => checkAnswer(form.spec, { values: { name: "a" }, note })

  it("DES-FORM-008 補足の前後の空白を除き、空なら補足なしとして回答に入れない", () => {
    const noted = Result.getOrThrow(answer(" SQLiteにしたい\n"))
    assert.equal(noted.note, "SQLiteにしたい")
    assert.equal(outcomeFor(form, "submit", noted).status, "submitted")
    assert.deepEqual(outcomeFor(form, "submit", noted), {
      status: "submitted",
      values: { name: "a" },
      held: [],
      changedByUser: [],
      computed: {},
      note: "SQLiteにしたい"
    })
    const blank = Result.getOrThrow(answer("  "))
    assert.equal(blank.note, undefined)
    assert.equal("note" in outcomeFor(form, "submit", blank), false)
    assert.equal(Result.getOrThrow(answer()).note, undefined)
  })

  it("DES-FORM-008 文字列でない補足と長すぎる補足を、値の誤りと一緒に返す", () => {
    assert.ok(Result.isSuccess(answer("x".repeat(2000))))
    assert.ok(Result.isFailure(answer("x".repeat(2001))))
    assert.ok(Result.isFailure(answer(`${"x".repeat(1999)}  `)))
    const both = checkAnswer(form.spec, { values: { name: 1 }, note: 1 })
    assert.ok(Result.isFailure(both))
    assert.equal(both.failure.length, 2)
  })
})

const choice = { type: "choice", id: "due", label: "締め切り", options: ["yes", "no"].map((value) => ({ value, label: value })) }
const sizeField = { type: "number", id: "size", label: "件数", default: 20, min: 5, max: 100 }

describe("DES-FORM-007 値のない回答", () => {
  const spec = withFields([sizeField, choice, { type: "text", id: "memo", label: "補足", default: "なし" }])

  it("DES-FORM-007 値がなくコメントのある項目をheldに入れ、その設計図をheldFormに入れる", () => {
    const form = compiled(spec)
    const answer = Result.getOrThrow(
      checkAnswer(form.spec, { values: { due: "no", memo: "なし" }, held: ["size"], comments: { size: "予算次第" } })
    )
    assert.deepEqual(outcomeFor(form, "submit", answer), {
      status: "submitted",
      values: { due: "no", memo: "なし" },
      held: ["size"],
      changedByUser: ["due"],
      computed: {},
      comments: { size: "予算次第" },
      heldForm: { title: "t", fields: [form.spec.fields[0]] }
    })
  })

  it("DES-FORM-007 値とコメントの両方を受け付け、空欄の文字列は答えとして扱う", () => {
    const form = compiled(spec)
    const answer = Result.getOrThrow(checkAnswer(form.spec, { values: { size: 20, due: "no", memo: "" }, comments: { due: "来月から" } }))
    const outcome = outcomeFor(form, "submit", answer)
    assert.deepEqual(outcome.status === "submitted" ? [outcome.values, outcome.held, outcome.comments] : undefined, [
      { size: 20, due: "no", memo: "" },
      [],
      { due: "来月から" }
    ])
  })

  it("DES-FORM-007 値のない項目の申告漏れ、コメントのない値なし、値のある項目の申告を拒否する", () => {
    const form = compiled(spec)
    const failure = (input: Record<string, unknown>) => String(checkAnswer(form.spec, input).pipe(Result.flip, Result.getOrThrow))
    assert.match(failure({ values: { size: 20, due: "no" }, comments: { memo: "x" } }), /memo.*heldが必要/)
    assert.match(failure({ values: { size: 20, due: "no" }, held: ["memo"] }), /memo.*コメントが必要/)
    assert.match(failure({ values: { size: 20, due: "no", memo: "" }, held: ["size"] }), /size.*できません/)
    assert.match(failure({ values: {}, held: "size" }), /heldは項目のidの配列/)
  })

  it("DES-FORM-007 値と値なしの間の変更を差分に数え、送り直しの文章に書く", () => {
    const form = compiled(spec)
    const before = { values: { size: 20, due: "no", memo: "なし" } }
    assert.deepEqual(changedFields(form.spec, before.values, { due: "no", memo: "" }), ["size", "memo"])
    assert.equal(
      resendMessage(form.spec, before, { values: { due: "no", memo: "なし" } }, messages("ja")),
      "「t」で件数を回答なしに変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(form.spec, { values: { due: "no" } }, { values: { size: 30, due: "no" } }, messages("en")),
      'In "t", I changed 件数 to 30. Please apply it and continue.'
    )
  })
})

describe("DES-FORM-009 項目ごとのコメント", () => {
  const spec = withFields([sizeField, { type: "text", id: "memo", label: "補足", default: "なし" }])

  it("DES-FORM-009 前後の空白を除き、空のコメントを捨てて回答に入れる", () => {
    const form = compiled(spec)
    const answer = Result.getOrThrow(
      checkAnswer(form.spec, { values: { memo: "なし" }, held: ["size"], comments: { size: " 予算次第 ", memo: "  " } })
    )
    assert.deepEqual(answer.comments, { size: "予算次第" })
    const outcome = outcomeFor(form, "submit", answer)
    assert.deepEqual(outcome.status === "submitted" ? outcome.comments : undefined, { size: "予算次第" })
    assert.equal("comments" in outcomeFor(form, "submit", { values: { size: 20, memo: "なし" } }), false)
  })

  it("DES-FORM-009 有効でない項目へのコメント、文字列でないコメント、長すぎるコメントを拒否する", () => {
    const form = compiled(spec)
    const check = (comments: unknown) => checkAnswer(form.spec, { values: { size: 20, memo: "なし" }, comments })
    assert.ok(Result.isSuccess(check({ size: "x".repeat(500) })))
    assert.ok(Result.isFailure(check({ size: "x".repeat(501) })))
    assert.ok(Result.isFailure(check({ size: 1 })))
    assert.ok(Result.isFailure(check({ other: "x" })))
    assert.ok(Result.isFailure(check(["x"])))
  })

  it("DES-FORM-009 設定の定型文は、文字列だけを空白を除いて8個まで使い、配列でなければ既定に任せる", () => {
    assert.equal(commentPresetsFrom(null), undefined)
    assert.equal(commentPresetsFrom("あとで"), undefined)
    assert.deepEqual(commentPresetsFrom([]), [])
    assert.deepEqual(commentPresetsFrom([" あとで ", 1, "", "x".repeat(501), "任せる"]), ["あとで", "任せる"])
    assert.equal(commentPresetsFrom(Array.from({ length: 10 }, (_, index) => String(index)))?.length, 8)
  })

  it("DES-FORM-009 コメントだけの変更も差分に数え、送り直しの文章に書く", () => {
    const form = compiled(spec)
    const values = { size: 20, memo: "なし" }
    assert.equal(
      resendMessage(form.spec, { values }, { values, comments: { size: "多めに" } }, messages("ja")),
      "「t」で件数のコメントを「多めに」に変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(
        form.spec,
        { values, comments: { size: "多めに" } },
        { values: { ...values, size: 30 }, comments: { size: "多めに" } },
        messages("ja")
      ),
      "「t」で件数を30(コメント: 多めに)に変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(form.spec, { values, comments: { size: "多めに" } }, { values }, messages("ja")),
      "「t」で件数のコメントをなしに変えたので、反映して続けてください。"
    )
    assert.equal(
      resendMessage(form.spec, { values, comments: { size: "a" } }, { values, comments: { size: " a " } }, messages("ja")),
      undefined
    )
  })

  it("DES-SPEC-001 defaultのない項目のreasonとreasonDetailsを指摘する", () => {
    assert.match(problems(withFields([{ ...choice, reason: "理由" }])).join("\n"), /due.*defaultがない/)
    assert.match(problems(withFields([{ type: "text", id: "a", label: "A", reasonDetails: "詳しく" }])).join("\n"), /a.*defaultがない/)
    assert.equal(compiled(withFields([{ ...choice, default: "yes", reason: "理由" }])).spec.fields.length, 1)
  })
})
