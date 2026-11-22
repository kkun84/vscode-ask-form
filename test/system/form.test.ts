import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { Effect, Fiber, Result } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"
import { eventSpec } from "../fixtures/event.ts"
import { storageForm, storageSpec } from "../fixtures/storage.ts"
import { structured, text, withHarness, type Harness } from "../support/host.ts"

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
        yield* rejected(h, { title: "x".repeat(161), fields: [field()] })
        yield* rejected(h, { title: "t", fields: [] })
        yield* rejected(h, { title: "t", fields: Array.from({ length: 21 }, (_, i) => field({ id: `f${i}` })) })
        yield* rejected(h, { title: "t", fields: [field({ id: "1st" })] })
        yield* rejected(h, { title: "t", fields: [field({ type: "slider" })] })
        yield* rejected(h, { title: "t", fields: [field({ default: "d", reason: "r".repeat(121) })] })
      })
    ))

  it("SPEC-FORM-001 表示する文章は、目安の文字数を超えても2倍までは受け付ける", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          h.call("ask_form", {
            title: "x".repeat(160),
            fields: [field({ label: "l".repeat(120), description: "d".repeat(240), default: "d", reason: "r".repeat(120) })]
          })
        )
        yield* h.waitUntil(1)
        yield* Fiber.interrupt(fiber)
      })
    ))

  it("SPEC-FORM-001 AIに示すスキーマには、受け付ける上限を書き、目安は説明に書く", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const tool = yield* h.tool("ask_form")
        const title = (tool.inputSchema as { readonly properties: Record<string, unknown> }).properties["title"]
        assert.deepEqual(title, { type: "string", minLength: 1, maxLength: 160, description: "Aim for 80 characters or fewer." })
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
            field({ label: "名前2" }),
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
    {
      type: "choice",
      id: "on",
      label: "On",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" }
      ],
      default: "yes"
    },
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
    { id: "logic", label: "2", expression: "on == 'yes' && a >= 7 && !(b != 0) ? 1 : 0" },
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
        yield* h.call("form_answer", {
          formKey: key,
          action: "submit",
          values: initialValues(compile(expressionSpec).pipe(Result.getOrThrow).spec)
        })
        const computed = structured(yield* Fiber.join(fiber))["computed"]
        assert.deepEqual(computed, { arith: 18.5, logic: 1, funcs: 9.23, choice: 2, text: true, prior: 27.73, divide: null })
      })
    ))
})

describe("SPEC-TOOL-003 回答を待つ", () => {
  it("SPEC-TOOL-003 選ばれていない選択肢の項目は回答に入れない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const values = { ...initialValues(storageForm.spec), storage: "server", port: 3000 }
        const fiber = yield* Effect.forkChild(h.call("ask_form", storageSpec))
        yield* h.waitUntil(1)
        yield* h.call("form_answer", { formKey: storageForm.key, action: "submit", values })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { name: "my-todo", storage: "server", port: 3000, auth: "no" })
        assert.deepEqual(outcome["changedByUser"], ["storage", "port"])
        assert.deepEqual(outcome["computed"], { cost: 1000 })
      })
    ))
})

const rankingSpec = {
  title: "作業の順番",
  fields: [
    {
      type: "ranking",
      id: "order",
      label: "優先順位",
      default: ["auth", "api", "ui"],
      options: [
        { value: "ui", label: "画面" },
        { value: "api", label: "API" },
        { value: "auth", label: "ログイン" }
      ]
    }
  ]
}

const rankingOptions = (count: number) => Array.from({ length: count }, (_, i) => ({ value: `v${i}`, label: `L${i}` }))

describe("SPEC-FORM-001 並べ替えの項目", () => {
  it("SPEC-FORM-001 並べ替えの項目を受け付け、選択肢が2〜8個でなければ拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(rankingSpec)), true)
        yield* rejected(h, { title: "t", fields: [{ type: "ranking", id: "r", label: "R", options: rankingOptions(9) }] })
        yield* rejected(h, { title: "t", fields: [{ type: "ranking", id: "r", label: "R", options: rankingOptions(1) }] })
      })
    ))

  it("SPEC-FORM-002 並べ替えの選択肢の重複、範囲の誤ったminとmax、範囲を外れた推奨を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile({ ...rankingSpec, fields: [{ ...rankingSpec.fields[0], default: ["auth"] }] })), true)
        const message = yield* rejected(h, {
          title: "t",
          fields: [
            { ...rankingSpec.fields[0], id: "few", min: 2, default: ["auth"] },
            { ...rankingSpec.fields[0], id: "twice", default: ["auth", "auth"] },
            {
              type: "ranking",
              id: "bounds",
              label: "B",
              min: 3,
              max: 2,
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
                { value: "c", label: "C" }
              ]
            },
            {
              type: "ranking",
              id: "dup",
              label: "D",
              options: [
                { value: "a", label: "A" },
                { value: "a", label: "B" }
              ]
            }
          ]
        })
        assert.match(message, /few.*重複なく2〜3個/)
        assert.match(message, /twice.*重複なく1〜3個/)
        assert.match(message, /bounds.*min≦max/)
        assert.match(message, /dup.*重複/)
      })
    ))
})

describe("SPEC-TOOL-003 並べ替えの回答", () => {
  it("SPEC-TOOL-003 並べ替えは一部だけの順位も受け付け、順番の違いを変更として扱い、上限を超えるか重複した回答を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const spec = { ...rankingSpec, fields: [{ ...rankingSpec.fields[0], max: 2, default: ["auth", "api"] }] }
        const form = compile(spec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", spec))
        yield* h.waitUntil(1)
        const over = yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { order: ["ui", "api", "auth"] } })
        assert.equal(over.isError, true)
        assert.match(text(over), /order.*重複なく1〜2個/)
        const twice = yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { order: ["ui", "ui"] } })
        assert.equal(twice.isError, true)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { order: ["ui", "auth"] } })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { order: ["ui", "auth"] })
        assert.deepEqual(outcome["changedByUser"], ["order"])
      })
    ))
})
