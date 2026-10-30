import assert from "node:assert/strict"
import { it } from "node:test"
import { Result } from "effect"
import { changedFields, computeValues, initialValues, outcomeFor, resendMessage } from "../../src/core/form.ts"
import { messages } from "../../src/core/messages.ts"
import { checkValues, compile } from "../../src/core/validate.ts"
import { eventSpec } from "../fixtures/event.ts"

const selectionSpec = (defaults: ReadonlyArray<string>) => ({
  title: "選択",
  fields: [
    {
      type: "choice",
      id: "selection",
      label: "選択肢",
      multiple: true,
      options: ["a", "b\u0000c", "a\u0000b", "c"].map((value) => ({ value, label: value })),
      default: defaults
    }
  ],
  computed: [{ id: "count", label: "選択数", expression: "selection" }]
})

it("DES-FORM-003 NULを含む複数選択の変更を検出し、並び順だけの違いは無視する", () => {
  const form = compile(selectionSpec(["a", "b\u0000c"])).pipe(Result.getOrThrow)
  const before = initialValues(form.spec)
  const after = { selection: Object.freeze(["c", "a\u0000b"]) }
  assert.deepEqual(changedFields(form.spec, before, after), ["selection"])
  assert.deepEqual(changedFields(form.spec, after, { selection: ["a\u0000b", "c"] }), [])
  assert.deepEqual(outcomeFor(form, "submit", after), {
    status: "submitted",
    values: after,
    changedByUser: ["selection"],
    computed: { count: 2 }
  })
  assert.equal(
    resendMessage(form.spec, before, after, messages("ja")),
    "「選択」で選択肢をc、a\u0000bに変えたので、反映して続けてください。"
  )
})

it("DES-SPEC-001 複数選択のdefaultに重複した値があれば拒否する", () => {
  const result = compile(selectionSpec(["a", "a"]))
  assert.ok(Result.isFailure(result))
  assert.ok(result.failure.some((problem) => problem.includes("項目「selection」のdefault") && problem.includes("重複")))
})

it("DES-FORM-004 複数選択の回答に重複した値があれば拒否する", () => {
  const form = compile(selectionSpec(["a"])).pipe(Result.getOrThrow)
  const result = checkValues(form.spec, { selection: ["a", "a"] })
  assert.ok(Result.isFailure(result))
  assert.ok(result.failure.some((problem) => problem.includes("項目「selection」") && problem.includes("重複")))
})

it("DES-FORM-002 重複のない複数選択は空の配列も受け付け、表示する選択数で計算する", () => {
  for (const selection of [[], ["a"], ["a", "c"]]) {
    const form = compile(selectionSpec(selection)).pipe(Result.getOrThrow)
    const defaults = initialValues(form.spec)
    const checked = checkValues(form.spec, defaults).pipe(Result.getOrThrow)
    assert.deepEqual(checked, { selection })
    assert.deepEqual(computeValues(form, checked), { count: selection.length })
  }
})

for (const expression of ["42", "1 / 0"]) {
  it(`DES-FORM-002 __proto__の計算結果を保持し、後続の式とJSONにも残す(${expression})`, () => {
    const form = compile({
      ...eventSpec,
      computed: [
        { id: "__proto__", label: "結果", expression },
        { id: "next", label: "後続", expression: "__proto__ + 1" }
      ]
    }).pipe(Result.getOrThrow)
    const result = computeValues(form, initialValues(form.spec))
    const expected = { ["__proto__"]: expression === "42" ? 42 : null, next: expression === "42" ? 43 : null }
    assert.deepEqual(result, expected)
    assert.ok(Object.hasOwn(result, "__proto__"))
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), expected)
  })
}

it("DES-FORM-002 桁あふれの数値リテラルとそれを参照する計算結果はnullにする", () => {
  const form = compile({
    ...eventSpec,
    computed: [
      { id: "overflow", label: "桁あふれ", expression: "1e999" },
      { id: "comparison", label: "比較", expression: "overflow > 0" }
    ]
  }).pipe(Result.getOrThrow)
  assert.deepEqual(computeValues(form, initialValues(form.spec)), { overflow: null, comparison: null })
})

for (const id of ["true", "false"]) {
  it(`DES-SPEC-001 予約語${id}を項目と計算結果のidに使えない`, () => {
    for (const input of [
      { title: "予約語", fields: [{ type: "toggle", id, label: "切り替え", default: false }] },
      { ...eventSpec, computed: [{ id, label: "結果", expression: "42" }] }
    ]) {
      const result = compile(input)
      assert.ok(Result.isFailure(result), id)
      assert.match(result.failure.join("\n"), /id/)
    }
  })
}

it("DES-SPEC-001 予約語と一致しないidは計算式から参照できる", () => {
  const ids = ["trueValue", "false_value", "True", "False", "max"]
  const form = compile({
    title: "参照",
    fields: ids.map((id) => ({ type: "toggle", id, label: id, default: false })),
    computed: ids.map((id) => ({ id: `${id}Result`, label: id, expression: `${id} ? 1 : 0` }))
  }).pipe(Result.getOrThrow)
  assert.deepEqual(computeValues(form, initialValues(form.spec)), Object.fromEntries(ids.map((id) => [`${id}Result`, 0])))
})
