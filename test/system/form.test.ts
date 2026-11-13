import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Result } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"
import { eventSpec } from "../fixtures/event.ts"
import { storageForm, storageSpec } from "../fixtures/storage.ts"
import { structured, text, withHarness, type Harness } from "../support/server.ts"

const rejected = (h: Harness, spec: Record<string, unknown>) =>
  Effect.gen(function* () {
    const result = yield* h.call("ask_form", spec)
    assert.equal(result.isError, true)
    return text(result)
  })

const field = (overrides: Record<string, unknown> = {}) => ({ type: "text", id: "name", label: "名前", ...overrides })

describe("SPEC-FORM-001 設計図の形", () => {
  it("SPEC-FORM-001 すべての種類の項目と計算結果を持つ設計図を受け付ける", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(h.call("ask_form", { ...eventSpec, unknownKey: true }))
        yield* h.waitUntil(1)
        yield* Fiber.interrupt(fiber)
      })
    ))

  it("SPEC-FORM-001 長さ、個数、idの形の制約に反する設計図を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* rejected(h, { title: "x".repeat(81), fields: [field()] })
        yield* rejected(h, { title: "t", fields: [] })
        yield* rejected(h, { title: "t", fields: Array.from({ length: 21 }, (_, i) => field({ id: `f${i}` })) })
        yield* rejected(h, { title: "t", fields: [field({ id: "1st" })] })
        yield* rejected(h, { title: "t", fields: [field({ type: "slider" })] })
        yield* rejected(h, { title: "t", fields: [field({ reason: "r".repeat(121) })] })
      })
    ))
})

describe("SPEC-FORM-001 選択肢ごとの項目", () => {
  it("SPEC-FORM-001 選択肢がfieldsを持つ設計図を受け付ける", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(h.call("ask_form", storageSpec))
        yield* h.waitUntil(1)
        yield* Fiber.interrupt(fiber)
      })
    ))

  it("SPEC-FORM-002 複数選択の枝、2段の入れ子、枝をまたぐidの重複、40個を超える項目を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const two = [{ value: "b", label: "B" }]
        const message = yield* rejected(h, {
          title: "t",
          fields: [
            field(),
            {
              type: "choice",
              id: "m",
              label: "M",
              multiple: true,
              options: [{ value: "a", label: "A", fields: [field({ id: "x" })] }, ...two]
            },
            {
              type: "choice",
              id: "d",
              label: "D",
              options: [
                {
                  value: "a",
                  label: "A",
                  fields: [
                    { type: "choice", id: "inner", label: "I", options: [{ value: "a", label: "A", fields: [field({ id: "z" })] }, ...two] }
                  ]
                },
                { value: "b", label: "B", fields: [field()] }
              ]
            }
          ]
        })
        for (const expected of ["id「name」が重複しています", "項目「m」は複数選択なので", "項目「inner」の選択肢にfieldsがあります"]) {
          assert.ok(message.includes(expected), `${expected} in ${message}`)
        }
        const wide = Array.from({ length: 5 }, (_, index) => ({
          type: "choice",
          id: `c${index}`,
          label: "C",
          options: [{ value: "a", label: "A", fields: Array.from({ length: 8 }, (_item, n) => field({ id: `f${index}_${n}` })) }, ...two]
        }))
        assert.match(yield* rejected(h, { title: "t", fields: wide }), /入れ子も含めて45個/)
      })
    ))
})

describe("SPEC-FORM-002 設計図の意味的な検査", () => {
  it("SPEC-FORM-002 意味の誤りをすべて列挙して返す", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const message = yield* rejected(h, {
          title: "t",
          fields: [
            field(),
            field({ type: "toggle" }),
            { type: "number", id: "n", label: "N", min: 0, max: 10, default: 11 },
            {
              type: "choice",
              id: "c",
              label: "C",
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" }
              ],
              default: "z"
            },
            {
              type: "choice",
              id: "m",
              label: "M",
              multiple: true,
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" }
              ],
              default: "a"
            }
          ],
          computed: [
            { id: "x", label: "X", expression: "later + 1" },
            { id: "later", label: "L", expression: "n *" }
          ]
        })
        for (const expected of [
          "id「name」が重複しています",
          "defaultが0〜10の範囲外です",
          "default「z」が選択肢にありません",
          "項目「m」のdefaultは配列にしてください",
          "「later」を参照しています",
          "計算結果「later」の式の"
        ]) {
          assert.ok(message.includes(expected), `${expected} in ${message}`)
        }
      })
    ))
})

const expressionSpec = {
  title: "式",
  fields: [
    { type: "number", id: "a", label: "A", min: 0, max: 100, default: 7 },
    { type: "number", id: "b", label: "B", min: 0, max: 100, default: 0 },
    { type: "toggle", id: "on", label: "On", default: true },
    {
      type: "choice",
      id: "pick",
      label: "Pick",
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" }
      ],
      default: "y"
    },
    {
      type: "choice",
      id: "many",
      label: "Many",
      multiple: true,
      options: [
        { value: "x", label: "X" },
        { value: "y", label: "Y" },
        { value: "z", label: "Z" }
      ],
      default: ["x", "z"]
    },
    { type: "text", id: "word", label: "Word", default: "hi" }
  ],
  computed: [
    { id: "arith", label: "1", expression: "(a + 3) * 2 - a % 4 / 2" },
    { id: "logic", label: "2", expression: "on && a >= 7 && !(b != 0) ? 1 : 0" },
    { id: "funcs", label: "3", expression: "max(min(a, 5), abs(-2)) + floor(2.7) + ceil(0.2) + round(1.234, 2)" },
    { id: "choice", label: "4", expression: "pick == 'y' ? many : -1" },
    { id: "text", label: "5", expression: 'word == "hi"' },
    { id: "prior", label: "6", expression: "arith + funcs" },
    { id: "divide", label: "7", expression: "a / b" }
  ]
}

describe("SPEC-EXPR-001 計算式", () => {
  it("SPEC-EXPR-001 演算子、関数、項目の値と前の計算結果を使って計算し、評価できない結果は空にする", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const { key } = compile(expressionSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", expressionSpec))
        yield* h.waitUntil(1)
        yield* h.call("form_answer", { formKey: key, action: "delegate" })
        const computed = structured(yield* Fiber.join(fiber))["computed"]
        assert.deepEqual(computed, { arith: 18.5, logic: 1, funcs: 9.23, choice: 2, text: true, prior: 27.73, divide: null })
      })
    ))
})

describe("SPEC-MCP-003 回答を待つ", () => {
  it("SPEC-MCP-003 選ばれていない選択肢の項目は回答に入れない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const values = { ...initialValues(storageForm.spec), storage: "server", port: 3000 }
        const fiber = yield* Effect.forkChild(h.call("ask_form", storageSpec))
        yield* h.waitUntil(1)
        yield* h.call("form_answer", { formKey: storageForm.key, action: "submit", values })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { name: "my-todo", storage: "server", port: 3000, auth: false })
        assert.deepEqual(outcome["changedByUser"], ["storage", "port"])
        assert.deepEqual(outcome["computed"], { cost: 1000 })
      })
    ))
})
