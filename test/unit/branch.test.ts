import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Result } from "effect"
import {
  activeFields,
  answerValues,
  changedFields,
  computeValues,
  initialValues,
  outcomeFor,
  resendMessage,
  type Values
} from "../../src/core/form.ts"
import { messages } from "../../src/core/messages.ts"
import { checkValues, compile } from "../../src/core/validate.ts"
import { storageForm, storageSpec } from "../fixtures/storage.ts"
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

describe("DES-FORM-006 有効な項目と値", () => {
  it("DES-FORM-006 選ばれた選択肢の項目だけを有効にする", () => {
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

  it("DES-FORM-006 初期値はすべての枝の項目に持ち、回答の値は選んだ枝の項目だけにする", () => {
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

  it("DES-FORM-006 AIに任せたときも選んだ枝の項目だけを返す", () => {
    const outcome = outcomeFor(storageForm, "delegate", initialValues(storageForm.spec))
    assert.equal(outcome.status, "delegated")
    assert.deepEqual(outcome.status === "delegated" ? outcome.values : undefined, {
      name: "my-todo",
      storage: "browser",
      engine: "local"
    })
  })

  it("DES-FORM-006 選ばれていない枝の項目は計算式で未定義になる", () => {
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
  it("DES-FORM-006 枝を切り替えただけでは新しい枝の項目を変更と扱わない", () => {
    const initial = initialValues(storageForm.spec)
    const after = { ...initial, storage: "server", port: 3000 }
    assert.deepEqual(changedFields(storageForm.spec, initial, after), ["storage", "port"])
  })

  it("DES-FORM-006 送り直しでは新しく現れた枝の項目も差分に含める", () => {
    const before = answerValues(storageForm.spec, initialValues(storageForm.spec))
    const after = answerValues(storageForm.spec, { ...initialValues(storageForm.spec), storage: "server" })
    assert.deepEqual(changedFields(storageForm.spec, before, after), ["storage", "port", "auth"])
    assert.equal(
      resendMessage(storageForm.spec, before, after, messages("ja")),
      "「保存先の設定」で保存先をサーバー、ポートを8,080、ログインを不要に変えたので、反映して続けてください。"
    )
  })

  it("DES-FORM-006 値の検査は選んだ枝の項目だけを求め、ほかの枝の値を捨てる", () => {
    const checked = checkValues(storageForm.spec, { name: "a", storage: "server", port: 80, auth: "yes", engine: "local" })
    assert.deepEqual(Result.getOrThrow(checked), { name: "a", storage: "server", port: 80, auth: "yes" })
    const missing = checkValues(storageForm.spec, { name: "a", storage: "server", engine: "local" })
    assert.ok(Result.isFailure(missing))
    assert.deepEqual(missing.failure, ["項目「port」は数値が必要です", "項目「auth」は選択肢のどれかが必要です"])
  })

  it("DES-FORM-006 複数選択の枝、深い入れ子、枝の中で重複したid、多すぎる項目を拒否する", () => {
    const leaf = [
      { value: "a", label: "A" },
      { value: "b", label: "B" }
    ]
    assert.deepEqual(
      problems({
        title: "t",
        fields: [
          text("x"),
          choice("multi", [{ value: "a", label: "A", fields: [text("m")] }, ...leaf.slice(1)], { multiple: true }),
          choice("deep", [
            { value: "a", label: "A", fields: [choice("inner", [{ value: "a", label: "A", fields: [text("z")] }, ...leaf.slice(1)])] },
            ...leaf.slice(1)
          ]),
          choice("dup", [{ value: "a", label: "A", fields: [text("x")] }, ...leaf.slice(1)])
        ]
      }),
      [
        "id「x」が重複しています",
        "項目「inner」の選択肢にfieldsがあります。選択肢の中の項目は、さらに入れ子にできません",
        "項目「multi」は複数選択なので、選択肢にfieldsを付けられません"
      ]
    )
    const wide = Array.from({ length: 4 }, (_, index) =>
      choice(`c${index}`, [
        { value: "a", label: "A", fields: Array.from({ length: 10 }, (_item, n) => text(`n${n}_${index}`)) },
        ...leaf.slice(1)
      ])
    )
    assert.deepEqual(problems({ title: "t", fields: wide }), ["項目が入れ子も含めて44個あります。40個以下にしてください"])
  })
})
