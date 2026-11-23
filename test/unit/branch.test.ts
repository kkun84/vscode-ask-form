import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { Result } from "effect"
import {
  heldFields,
  activeFields,
  displayOrder,
  answerValues,
  changedFields,
  computeValues,
  initialValues,
  outcomeFor,
  type Values
} from "../../src/core/form.ts"
import { checkAnswer, checkValues, compile } from "../../src/core/validate.ts"
import { storageForm, storageSpec } from "../fixtures/storage.ts"
import { branchSpec } from "../fixtures/branches.ts"
import { problems } from "../support/compile.ts"

const choice = (id: string, options: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) => ({
  type: "choice",
  id,
  label: id,
  options,
  ...extra
})

const text = (id: string) => ({ type: "text", id, label: id })

const ids = (values: Values) => Object.keys(values)

const fieldIds = (fields: ReadonlyArray<{ readonly id: string }>) => fields.map((field) => field.id)

describe("DES-FORM-006 有効な項目と値", () => {
  it("DES-FORM-006 whenの選択肢が選ばれている項目だけを有効にする", () => {
    const spec = storageForm.spec
    assert.deepEqual(
      activeFields(spec, { storage: "browser" }).map((field) => field.id),
      ["name", "storage", "engine"]
    )
    assert.deepEqual(
      activeFields(spec, { storage: "server" }).map((field) => field.id),
      ["name", "storage", "port", "auth"]
    )
    assert.deepEqual(
      activeFields(spec, { storage: "none" }).map((field) => field.id),
      ["name", "storage"]
    )
  })

  it("DES-FORM-006 初期値はすべての項目に持ち、回答の値は見えている項目だけにする", () => {
    const initial = initialValues(storageForm.spec)
    assert.deepEqual(ids(initial), ["name", "storage", "engine", "port", "auth"])
    assert.deepEqual(answerValues(storageForm.spec, initial), { name: "my-todo", storage: "browser", engine: "local" })
    assert.deepEqual(answerValues(storageForm.spec, { ...initial, storage: "server" }), {
      name: "my-todo",
      storage: "server",
      port: 8080,
      auth: "no"
    })
  })

  it("DES-FORM-006 whenの参照先を保留にすると、その項目は回答にも保留にも入らない", () => {
    const values = answerValues(storageForm.spec, { name: "my-todo", engine: "indexed", port: 3000 })
    assert.deepEqual(values, { name: "my-todo" })
    const outcome = outcomeFor(storageForm, "submit", { values })
    assert.deepEqual(outcome.status === "submitted" ? outcome.held : undefined, ["storage"])
  })

  it("DES-FORM-006 隠れた項目は計算式で未定義になる", () => {
    const initial = initialValues(storageForm.spec)
    assert.deepEqual(computeValues(storageForm, { ...initial, storage: "server", auth: "yes" }), { cost: 1500 })
    assert.deepEqual(computeValues(storageForm, initial), { cost: 0 })
    const form = compile({
      title: "t",
      fields: storageSpec.fields,
      computed: [{ id: "doubled", label: "d", expression: "port * 2" }]
    }).pipe(Result.getOrThrow)
    assert.deepEqual(computeValues(form, initial), { doubled: null })
  })
})

describe("DES-FORM-006 差分と検査", () => {
  it("DES-FORM-006 選択を切り替えただけでは現れた項目を変更と扱わない", () => {
    const initial = initialValues(storageForm.spec)
    const after = { ...initial, storage: "server", port: 3000 }
    assert.deepEqual(changedFields(storageForm.spec, initial, after), ["storage", "port"])
  })

  it("DES-FORM-006 値の検査は見えている項目だけを求め、隠れた項目の値を捨てる", () => {
    const checked = checkValues(storageForm.spec, { name: "a", storage: "server", port: 80, auth: "yes", engine: "local" })
    assert.deepEqual(Result.getOrThrow(checked), { name: "a", storage: "server", port: 80, auth: "yes" })
    const missing = checkAnswer(storageForm.spec, { values: { name: "a", storage: "server", engine: "local" } })
    assert.ok(Result.isFailure(missing))
    assert.deepEqual(missing.failure, [
      "項目「port」は値か、heldが必要です",
      "項目「auth」は値か、heldが必要です",
      "項目「port」は値がないので、コメントが必要です",
      "項目「auth」は値がないので、コメントが必要です"
    ])
    const held = checkAnswer(storageForm.spec, {
      values: { storage: "server", auth: "yes" },
      held: ["name", "port"],
      comments: { name: "あとで", port: "任せる" }
    })
    assert.deepEqual(Result.getOrThrow(held).values, { storage: "server", auth: "yes" })
    assert.deepEqual(heldFields(storageForm.spec, Result.getOrThrow(held).values), ["name", "port"])
    const wrong = checkAnswer(storageForm.spec, {
      values: { name: "a", storage: "browser", engine: "local" },
      held: ["engine", "port"]
    })
    assert.ok(Result.isFailure(wrong))
    assert.equal(wrong.failure.length, 2)
  })

  it("DES-FORM-006 whenの参照先と値が正しくない設計図と、whenをたどると循環する設計図を拒否する", () => {
    const ab = [
      { value: "a", label: "A" },
      { value: "b", label: "B" }
    ]
    assert.deepEqual(
      problems({
        title: "t",
        fields: [
          text("plain"),
          choice("pick", ab),
          { ...text("self"), when: { field: "self", anyOf: ["a"] } },
          { ...text("unknown"), when: { field: "nothing", anyOf: ["a"] } },
          { ...text("notChoice"), when: { field: "plain", anyOf: ["a"] } },
          { ...text("missing"), when: { field: "pick", anyOf: ["a", "c"] } },
          { ...text("twice"), when: { field: "pick", anyOf: ["b", "b"] } },
          { ...choice("ping", ab), when: { field: "pong", anyOf: ["a"] } },
          { ...choice("pong", ab), when: { field: "ping", anyOf: ["a"] } },
          { ...text("hanging"), when: { field: "ping", anyOf: ["b"] } }
        ]
      }),
      [
        "項目「self」のwhenが自分自身を参照しています",
        "項目「unknown」のwhenが未定義の項目「nothing」を参照しています",
        "項目「notChoice」のwhenが参照する項目「plain」は、choiceかsearchChoiceではありません",
        "項目「missing」のwhenのanyOfの「c」が、項目「pick」の選択肢にありません",
        "項目「twice」のwhenのanyOfが重複しています",
        "項目「ping」のwhenをたどると「ping」→「pong」→「ping」と循環し、whenのない項目にたどり着きません",
        "項目「pong」のwhenをたどると「pong」→「ping」→「pong」と循環し、whenのない項目にたどり着きません",
        "項目「hanging」のwhenをたどると「hanging」→「ping」→「pong」→「ping」と循環し、whenのない項目にたどり着きません"
      ]
    )
  })
})

describe("DES-FORM-006 表示の順", () => {
  it("DES-FORM-006 続きの質問は、設計図のどこに書いても元の質問のすぐ後ろに、兄弟の間では設計図の順に並ぶ", () => {
    const form = compile(branchSpec).pipe(Result.getOrThrow)
    assert.deepEqual(fieldIds(displayOrder(form.spec)), [
      "auth",
      "tenant",
      "minLength",
      "mfa",
      "mfaApp",
      "notify",
      "from",
      "channel",
      "quiet",
      "release"
    ])
    assert.deepEqual(fieldIds(activeFields(form.spec, initialValues(form.spec))), [
      "auth",
      "minLength",
      "mfa",
      "mfaApp",
      "notify",
      "from",
      "channel",
      "quiet",
      "release"
    ])
    assert.deepEqual(fieldIds(activeFields(form.spec, { ...initialValues(form.spec), mfa: "off", notify: ["sms"] })), [
      "auth",
      "minLength",
      "mfa",
      "notify",
      "quiet",
      "release"
    ])
  })

  it("DES-FORM-006 heldと聞き直しの設計図は、設計図の順ではなく表示の順に並べる", () => {
    const form = compile(branchSpec).pipe(Result.getOrThrow)
    const values = { auth: "password", mfa: "required", notify: ["sms"] }
    assert.deepEqual(heldFields(form.spec, values), ["minLength", "mfaApp", "quiet", "release"])
    const outcome = outcomeFor(form, "submit", {
      values,
      comments: { minLength: "任せる", mfaApp: "任せる", quiet: "任せる", release: "任せる" }
    })
    assert.ok(outcome.status === "submitted")
    assert.deepEqual(fieldIds(outcome.heldForm?.fields ?? []), ["minLength", "mfaApp", "quiet", "release"])
  })
})

describe("DES-FORM-006 条件の連鎖と複数選択", () => {
  const form = compile({
    title: "t",
    fields: [
      choice(
        "tools",
        [
          { value: "lint", label: "Lint" },
          { value: "test", label: "Test" },
          { value: "docs", label: "Docs" }
        ],
        { multiple: true, default: ["lint"] }
      ),
      {
        ...choice("runner", [
          { value: "vitest", label: "Vitest" },
          { value: "jest", label: "Jest" }
        ]),
        when: { field: "tools", anyOf: ["test"] }
      },
      { ...text("config"), when: { field: "runner", anyOf: ["jest"] } }
    ],
    computed: [{ id: "picked", label: "p", expression: "runner == 'jest' ? 1 : 0" }]
  }).pipe(Result.getOrThrow)

  const shown = (values: Values) => activeFields(form.spec, values).map((field) => field.id)

  it("DES-FORM-006 複数選択はどれかが選ばれていれば見せ、参照先が隠れると連鎖して隠す", () => {
    assert.deepEqual(shown({ tools: ["lint", "test"], runner: "jest", config: "" }), ["tools", "runner", "config"])
    assert.deepEqual(shown({ tools: ["lint"], runner: "jest", config: "" }), ["tools"])
    assert.deepEqual(shown({ tools: [], runner: "jest" }), ["tools"])
  })

  it("DES-FORM-006 隠れた項目は回答にも保留にも入らず、計算式で未定義になる", () => {
    const values = { tools: ["docs"], runner: "jest", config: "x" }
    const outcome = outcomeFor(form, "submit", { values: answerValues(form.spec, values), comments: { config: "捨てる" } })
    assert.deepEqual(outcome, {
      status: "submitted",
      values: { tools: ["docs"] },
      held: [],
      changedByUser: ["tools"],
      computed: { picked: null }
    })
    assert.deepEqual(computeValues(form, values), { picked: null })
    assert.deepEqual(computeValues(form, { ...values, tools: ["test"] }), { picked: 1 })
  })

  it("DES-FORM-006 保留の項目の設計図は、保留にない項目を参照するwhenを外す", () => {
    const outcome = outcomeFor(form, "submit", { values: { tools: ["test"], runner: "jest" }, comments: { config: "あとで" } })
    assert.ok(outcome.status === "submitted")
    assert.deepEqual(outcome.held, ["config"])
    assert.deepEqual(outcome.heldForm?.fields, [{ type: "text", id: "config", label: "config" }])
  })
})
