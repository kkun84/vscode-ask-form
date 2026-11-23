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

const rejectedWith = (h: Harness, spec: Record<string, unknown>, patterns: ReadonlyArray<RegExp>) =>
  Effect.gen(function* () {
    const message = yield* rejected(h, spec)
    for (const pattern of patterns) {
      assert.match(message, pattern)
    }
  })

const refused = (h: Harness, formKey: string, values: Record<string, unknown>, pattern: RegExp) =>
  Effect.gen(function* () {
    const result = yield* h.call("form_answer", { formKey, action: "submit", values })
    assert.equal(result.isError, true)
    assert.match(text(result), pattern)
  })

const field = (overrides: Record<string, unknown> = {}) => ({ type: "text", id: "name", label: "名前", ...overrides })

describe("SPEC-FORM-001 設計図の形", () => {
  it("SPEC-FORM-001 すべての種類の項目と計算結果を持つ設計図を受け付ける", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(h.call("ask_form", eventSpec))
        yield* h.waitUntil(1)
        yield* Fiber.interrupt(fiber)
      })
    ))

  it("SPEC-FORM-001 長さ、個数、idの形の制約に反する設計図を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        yield* rejected(h, { title: "x".repeat(161), fields: [field()] })
        yield* rejected(h, { title: "t", fields: [] })
        yield* rejected(h, { title: "t", fields: Array.from({ length: 41 }, (_, i) => field({ id: `f${i}` })) })
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

const schemaPaths = (node: unknown, bad: (record: Record<string, unknown>) => boolean, path = "$"): ReadonlyArray<string> => {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => schemaPaths(item, bad, `${path}[${index}]`))
  }
  if (node === null || typeof node !== "object") {
    return []
  }
  const record = node as Record<string, unknown>
  return [...(bad(record) ? [path] : []), ...Object.entries(record).flatMap(([key, value]) => schemaPaths(value, bad, `${path}.${key}`))]
}

const arraysWithoutItems = (schema: unknown) => schemaPaths(schema, (record) => record["type"] === "array" && record["items"] === undefined)

const openObjects = (schema: unknown) =>
  schemaPaths(schema, (record) => record["type"] === "object" && record["additionalProperties"] !== false)

describe("SPEC-FORM-001 AIに示すスキーマの形", () => {
  it("SPEC-FORM-001 表にないキーを許すオブジェクトを書かない", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const tool = yield* h.tool("ask_form")
        assert.deepEqual(openObjects(tool.inputSchema), [])
      })
    ))

  it("SPEC-FORM-001 VS Codeがツールの定義を拒否しないよう、配列にはすべてitemsを書く", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const tool = yield* h.tool("ask_form")
        assert.deepEqual(arraysWithoutItems(tool.inputSchema), [])
      })
    ))
})

describe("SPEC-FORM-001 条件付きの項目", () => {
  it("SPEC-FORM-001 前にも後ろにもある単一選択か複数選択の項目を参照するwhenを持つ設計図を受け付ける", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(
          Result.isSuccess(
            compile({
              title: "t",
              fields: [
                field({ when: { field: "pkgs", anyOf: ["v1", "v2"] } }),
                { type: "searchChoice", id: "pkgs", label: "P", multiple: true, options: searchOptions(7) }
              ]
            })
          ),
          true
        )
        const fiber = yield* Effect.forkChild(h.call("ask_form", storageSpec))
        yield* h.waitUntil(1)
        yield* Fiber.interrupt(fiber)
      })
    ))

  it("SPEC-FORM-002 whenが未定義の項目、選択でない項目、選択肢に無い値を参照する設計図と、whenが循環する設計図を拒否する", () =>
    withHarness((h) =>
      rejectedWith(
        h,
        {
          title: "t",
          fields: [
            field({ id: "early", when: { field: "nothing", anyOf: ["a"] } }),
            {
              type: "choice",
              id: "pick",
              label: "P",
              when: { field: "pick", anyOf: ["a"] },
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" }
              ]
            },
            field({ id: "typed", when: { field: "early", anyOf: ["a"] } }),
            field({ id: "stray", when: { field: "pick", anyOf: ["z"] } })
          ]
        },
        [
          /early.*未定義の項目「nothing」/,
          /pick.*自分自身/,
          /stray.*循環/,
          /typed.*early.*choiceかsearchChoiceではありません/,
          /stray.*z.*選択肢にありません/
        ]
      )
    ))
})

describe("SPEC-FORM-002 設計図の意味的な検査", () => {
  it("SPEC-FORM-002 表にないキーを持つ設計図を、場所を示して拒否する", () =>
    withHarness((h) =>
      rejectedWith(h, { title: "t", fields: [field({ when: { field: "c", anyof: ["a"] } })] }, [/fields\[0\]\.when\.anyof/])
    ))

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
  it("SPEC-TOOL-003 whenの条件を満たさず表示されていない項目は回答に入れない", () =>
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

const searchOptions = (count: number) => Array.from({ length: count }, (_, i) => ({ value: `v${i}`, label: `候補${i}` }))

const searchForm = (count: number) => ({
  title: "t",
  fields: [{ type: "searchChoice", id: "s", label: "S", options: searchOptions(count) }]
})

const searchSpec = {
  title: "候補",
  fields: [
    { type: "searchChoice", id: "one", label: "1つ", options: searchOptions(12) },
    { type: "searchChoice", id: "many", label: "複数", multiple: true, default: ["v1"], options: searchOptions(12) }
  ],
  computed: [{ id: "count", label: "数", expression: "many" }]
}

describe("SPEC-FORM-001 候補を絞り込む項目", () => {
  it("SPEC-FORM-001 searchChoiceの項目は選択肢が7〜100個なら受け付け、6個以下か101個以上なら拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(searchSpec)), true)
        assert.equal(Result.isSuccess(compile(searchForm(7))), true)
        assert.equal(Result.isSuccess(compile(searchForm(100))), true)
        yield* rejected(h, searchForm(6))
        yield* rejected(h, searchForm(101))
      })
    ))

  it("SPEC-FORM-002 searchChoiceの選択肢の重複、選択肢に無い推奨、multipleと形の合わない推奨を拒否する", () =>
    withHarness((h) =>
      rejectedWith(
        h,
        {
          title: "t",
          fields: [
            { type: "searchChoice", id: "dup", label: "D", options: [...searchOptions(7), { value: "v0", label: "重複" }] },
            { type: "searchChoice", id: "missing", label: "M", default: "zz", options: searchOptions(7) },
            { type: "searchChoice", id: "shape", label: "S", multiple: true, default: "v0", options: searchOptions(7) }
          ]
        },
        [/dup.*重複/, /missing.*zz.*選択肢にありません/, /shape.*配列/]
      )
    ))
})

describe("SPEC-TOOL-003 候補を絞り込む項目の回答", () => {
  it("SPEC-TOOL-003 選択肢に無い値を拒否し、複数の選択は選んだ数で計算する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const form = compile(searchSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", searchSpec))
        yield* h.waitUntil(1)
        yield* refused(h, form.key, { one: "nope", many: [] }, /one/)
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { one: "v7", many: ["v1", "v9"] } })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { one: "v7", many: ["v1", "v9"] })
        assert.deepEqual(outcome["computed"], { count: 2 })
        assert.deepEqual(outcome["changedByUser"], ["one", "many"])
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
        yield* rejectedWith(
          h,
          {
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
          },
          [/few.*重複なく2〜3個/, /twice.*重複なく1〜3個/, /bounds.*min≦max/, /dup.*重複/]
        )
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

const rangeSpec = {
  title: "対応範囲",
  fields: [{ type: "numberRange", id: "node", label: "Node.jsの版", min: 16, max: 24, step: 1, default: [18, 22] }]
}

describe("SPEC-FORM-001 範囲の項目", () => {
  it("SPEC-FORM-001 範囲の項目を受け付け、minとmaxの無いものを拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(rangeSpec)), true)
        yield* rejected(h, { title: "t", fields: [{ type: "numberRange", id: "r", label: "R", min: 0 }] })
        yield* rejected(h, { title: "t", fields: [{ type: "numberRange", id: "r", label: "R", min: 0, max: 10, default: [1] }] })
      })
    ))

  it("SPEC-FORM-002 範囲のminとmaxの逆転と、範囲外や下限が上限を超える推奨を拒否する", () =>
    withHarness((h) =>
      rejectedWith(
        h,
        {
          title: "t",
          fields: [
            { type: "numberRange", id: "flip", label: "F", min: 10, max: 0 },
            { type: "numberRange", id: "outside", label: "O", min: 0, max: 10, default: [-1, 5] },
            { type: "numberRange", id: "reversed", label: "R", min: 0, max: 10, default: [8, 2] }
          ]
        },
        [/flip.*min/, /outside.*\[下限, 上限\]/, /reversed.*\[下限, 上限\]/]
      )
    ))
})

describe("SPEC-TOOL-003 範囲の回答", () => {
  it("SPEC-TOOL-003 範囲は[下限, 上限]で届き、下限が上限を超える回答や範囲外の回答を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const form = compile(rangeSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", rangeSpec))
        yield* h.waitUntil(1)
        for (const node of [[22, 18], [10, 20], [18]]) {
          const bad = yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { node } })
          assert.equal(bad.isError, true)
          assert.match(text(bad), /node.*\[下限, 上限\]/)
        }
        yield* h.call("form_answer", { formKey: form.key, action: "submit", values: { node: [20, 24] } })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { node: [20, 24] })
        assert.deepEqual(outcome["changedByUser"], ["node"])
      })
    ))
})

const listSpec = {
  title: "除外の設定",
  fields: [{ type: "textList", id: "ignore", label: "除外するパス", default: ["dist", "node_modules"] }],
  computed: [{ id: "count", label: "除外の数", expression: "ignore" }]
}

const listWithDefault = (value: unknown) => ({ title: "t", fields: [{ type: "textList", id: "l", label: "L", default: value }] })

describe("SPEC-FORM-001 文字のリストの項目", () => {
  it("SPEC-FORM-001 文字のリストの項目を受け付け、21個以上や201文字以上の推奨を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(listSpec)), true)
        yield* rejected(h, listWithDefault(Array.from({ length: 21 }, (_, i) => `v${i}`)))
        yield* rejected(h, listWithDefault(["x".repeat(201)]))
        yield* rejected(h, listWithDefault([""]))
      })
    ))

  it("SPEC-FORM-002 文字のリストの推奨の重複を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const message = yield* rejected(h, { title: "t", fields: [{ type: "textList", id: "dup", label: "D", default: ["a", "a"] }] })
        assert.match(message, /dup.*重複/)
      })
    ))
})

describe("SPEC-TOOL-003 文字のリストの回答", () => {
  it("SPEC-TOOL-003 文字のリストは計算式で要素の数になり、重複や空の文字列を含む回答を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const form = compile(listSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", listSpec))
        yield* h.waitUntil(1)
        const answer = (ignore: unknown) => h.call("form_answer", { formKey: form.key, action: "submit", values: { ignore } })
        for (const bad of [["a", "a"], ["  "], "dist", Array.from({ length: 21 }, (_, i) => `v${i}`)]) {
          const result = yield* answer(bad)
          assert.equal(result.isError, true)
          assert.match(text(result), /ignore/)
        }
        yield* answer(["dist", "coverage", "out"])
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { ignore: ["dist", "coverage", "out"] })
        assert.deepEqual(outcome["changedByUser"], ["ignore"])
        assert.deepEqual(outcome["computed"], { count: 3 })
      })
    ))
})

const scheduleSpec = {
  title: "リリースの予定",
  fields: [
    { type: "date", id: "release", label: "リリース日", default: "2026-12-01", min: "2026-11-25", max: "2027-03-31" },
    { type: "time", id: "deploy", label: "デプロイの時刻", min: "09:00", max: "18:00", step: 30 }
  ],
  computed: [{ id: "christmas", label: "クリスマス", expression: "release == '2026-12-24' && deploy == '10:30'" }]
}

describe("SPEC-FORM-001 日付と時刻の項目", () => {
  it("SPEC-FORM-001 日付と時刻の項目を受け付け、形の合わない値を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(scheduleSpec)), true)
        yield* rejected(h, { title: "t", fields: [{ type: "date", id: "d", label: "D", default: "2026/12/01" }] })
        yield* rejected(h, { title: "t", fields: [{ type: "time", id: "t", label: "T", default: "24:00" }] })
        yield* rejected(h, { title: "t", fields: [{ type: "time", id: "t", label: "T", step: 0 }] })
      })
    ))

  it("SPEC-FORM-002 存在しない日付、逆の範囲、範囲外と刻みに合わない推奨を拒否する", () =>
    withHarness((h) =>
      rejectedWith(
        h,
        {
          title: "t",
          fields: [
            { type: "date", id: "feb", label: "A", default: "2026-02-30" },
            { type: "date", id: "rev", label: "B", min: "2026-12-01", max: "2026-11-01" },
            { type: "date", id: "out", label: "C", min: "2026-12-01", default: "2026-11-01" },
            { type: "time", id: "off", label: "D", min: "09:00", step: 30, default: "09:10" }
          ]
        },
        [/feb.*存在する日付/, /rev.*min/, /out.*範囲外/, /off.*30分刻み/]
      )
    ))
})

describe("SPEC-TOOL-005 日付と時刻の回答", () => {
  it("SPEC-TOOL-005 範囲外や刻みに合わない日付と時刻を拒否し、計算式では文字列として使える", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const form = compile(scheduleSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", scheduleSpec))
        yield* h.waitUntil(1)
        const answer = (values: Record<string, unknown>) => h.call("form_answer", { formKey: form.key, action: "submit", values })
        const outside = yield* answer({ release: "2027-04-01", deploy: "10:00" })
        assert.match(text(outside), /release.*範囲外/)
        const off = yield* answer({ release: "2026-12-24", deploy: "10:15" })
        assert.match(text(off), /deploy.*30分刻み/)
        const late = yield* answer({ release: "2026-12-24", deploy: "18:30" })
        assert.match(text(late), /deploy.*範囲外/)
        yield* answer({ release: "2026-12-24", deploy: "10:30" })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { release: "2026-12-24", deploy: "10:30" })
        assert.deepEqual(outcome["computed"], { christmas: true })
      })
    ))
})

const treeNodes = [
  {
    value: "src",
    label: "src",
    children: [
      { value: "src/ui", label: "ui", children: [{ value: "src/ui/app.ts", label: "app.ts" }] },
      { value: "src/core", label: "core" }
    ]
  },
  { value: "README.md", label: "README.md" }
]

const treeSpec = {
  title: "対象",
  fields: [
    { type: "treeChoice", id: "target", label: "直すファイル", nodes: treeNodes, default: "src/ui/app.ts" },
    { type: "treeChoice", id: "scope", label: "範囲", multiple: true, nodes: treeNodes, default: ["src/core"] }
  ],
  computed: [{ id: "count", label: "数", expression: "scope" }]
}

const treeLeaf = (index: number) => ({ value: `n${index}`, label: `N${index}` })

describe("SPEC-FORM-001 木の項目", () => {
  it("SPEC-FORM-001 木の項目を受け付け、5段の深さを拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        assert.equal(Result.isSuccess(compile(treeSpec)), true)
        const deep = {
          value: "a",
          label: "a",
          children: [
            {
              value: "b",
              label: "b",
              children: [{ value: "c", label: "c", children: [{ value: "d", label: "d", children: [treeLeaf(1)] }] }]
            }
          ]
        }
        yield* rejected(h, { title: "t", fields: [{ type: "treeChoice", id: "t", label: "T", nodes: [deep] }] })
      })
    ))

  it("SPEC-FORM-002 木のvalueの重複、101個の項目、木にない推奨、祖先と子の両方を含む推奨を拒否する", () =>
    withHarness((h) =>
      rejectedWith(
        h,
        {
          title: "t",
          fields: [
            { type: "treeChoice", id: "dup", label: "D", nodes: [treeLeaf(1), treeLeaf(1)] },
            { type: "treeChoice", id: "many", label: "M", nodes: Array.from({ length: 101 }, (_, i) => treeLeaf(i)) },
            { type: "treeChoice", id: "missing", label: "X", nodes: treeNodes, default: "lib" },
            { type: "treeChoice", id: "nested", label: "N", multiple: true, nodes: treeNodes, default: ["src", "src/ui"] }
          ]
        },
        [/dup.*重複/, /many.*101個/, /missing.*lib/, /nested.*src\/ui.*祖先/]
      )
    ))
})

describe("SPEC-TOOL-003 木の回答", () => {
  it("SPEC-TOOL-003 木の回答を受け付けて複数選択は数として計算し、木にない値を拒否する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const form = compile(treeSpec).pipe(Result.getOrThrow)
        const fiber = yield* Effect.forkChild(h.call("ask_form", treeSpec))
        yield* h.waitUntil(1)
        yield* refused(h, form.key, { target: "lib", scope: [] }, /target/)
        yield* h.call("form_answer", {
          formKey: form.key,
          action: "submit",
          values: { target: "src/ui", scope: ["src/core", "README.md"] }
        })
        const outcome = structured(yield* Fiber.join(fiber))
        assert.deepEqual(outcome["values"], { target: "src/ui", scope: ["src/core", "README.md"] })
        assert.deepEqual(outcome["changedByUser"], ["target", "scope"])
        assert.deepEqual(outcome["computed"], { count: 2 })
      })
    ))
})
