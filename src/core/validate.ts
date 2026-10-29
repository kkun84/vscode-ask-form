import { Result, Schema } from "effect"
import { references, parse } from "./expression.ts"
import { isMultiple, prepare, type CompiledForm, type FieldValue, type Values } from "./form.ts"
import { FormSpec, type ChoiceField, type Field, type NumberField } from "./spec.ts"

const decodeSpec = Schema.decodeUnknownResult(FormSpec, { errors: "all", onExcessProperty: "ignore" })

const duplicateIds = (spec: FormSpec): ReadonlyArray<string> => {
  const ids = [...spec.fields.map((field) => field.id), ...(spec.computed ?? []).map((item) => item.id)]
  return ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `id「${id}」が重複しています`)
}

const expressionProblems = (spec: FormSpec): ReadonlyArray<string> => {
  const known = new Set(spec.fields.map((field) => field.id))
  return (spec.computed ?? []).flatMap((item) => {
    const result = parse(item.expression)
    const problems = result.ok
      ? references(result.expr)
          .filter((name) => !known.has(name))
          .map((name) => `計算結果「${item.id}」の式が未定義か後ろにある「${name}」を参照しています`)
      : [`計算結果「${item.id}」の式の${result.error.position + 1}文字目: ${result.error.message}`]
    known.add(item.id)
    return problems
  })
}

const semanticProblems = (spec: FormSpec): ReadonlyArray<string> => [
  ...duplicateIds(spec),
  ...spec.fields.flatMap((field) => fieldProblems(field)),
  ...expressionProblems(spec)
]

const numberProblems = (field: NumberField): ReadonlyArray<string> => {
  if (field.min >= field.max) {
    return [`項目「${field.id}」のminがmax以上です`]
  }
  const outside = field.default !== undefined && (field.default < field.min || field.default > field.max)
  return outside ? [`項目「${field.id}」のdefaultが${field.min}〜${field.max}の範囲外です`] : []
}

const choiceDefaultProblems = (field: ChoiceField, values: ReadonlySet<string>): ReadonlyArray<string> => {
  if (field.default === undefined) {
    return []
  }
  const shape =
    isMultiple(field) === Array.isArray(field.default)
      ? []
      : [`項目「${field.id}」のdefaultは${isMultiple(field) ? "配列" : "1つの文字列"}にしてください`]
  const defaults = typeof field.default === "string" ? [field.default] : field.default
  return [
    ...shape,
    ...defaults.filter((value) => !values.has(value)).map((value) => `項目「${field.id}」のdefault「${value}」が選択肢にありません`)
  ]
}

const choiceProblems = (field: ChoiceField): ReadonlyArray<string> => {
  const values = new Set(field.options.map((option) => option.value))
  const duplicated = values.size === field.options.length ? [] : [`項目「${field.id}」の選択肢のvalueが重複しています`]
  return [...duplicated, ...choiceDefaultProblems(field, values)]
}

const fieldProblems = (field: Field): ReadonlyArray<string> => {
  switch (field.type) {
    case "number":
      return numberProblems(field)
    case "choice":
      return choiceProblems(field)
    default:
      return []
  }
}

export const compile = (input: unknown): Result.Result<CompiledForm, ReadonlyArray<string>> => {
  const decoded = decodeSpec(input)
  if (Result.isFailure(decoded)) {
    return Result.fail([decoded.failure.message])
  }
  const spec = decoded.success
  const problems = semanticProblems(spec)
  if (problems.length > 0) {
    return Result.fail(problems)
  }
  return Result.succeed(prepare(spec, input))
}

const numberProblem = (field: NumberField, value: unknown): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `項目「${field.id}」は数値が必要です`
  }
  return value < field.min || value > field.max ? `項目「${field.id}」が範囲外です` : undefined
}

const choiceProblem = (field: ChoiceField, value: unknown): string | undefined => {
  const allowed = new Set(field.options.map((option) => option.value))
  if (isMultiple(field)) {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item))
      ? undefined
      : `項目「${field.id}」は選択肢の配列が必要です`
  }
  return typeof value === "string" && allowed.has(value) ? undefined : `項目「${field.id}」は選択肢のどれかが必要です`
}

const valueProblem = (field: Field, value: unknown): string | undefined => {
  switch (field.type) {
    case "text":
      return typeof value === "string" ? undefined : `項目「${field.id}」は文字列が必要です`
    case "number":
      return numberProblem(field, value)
    case "choice":
      return choiceProblem(field, value)
    case "toggle":
      return typeof value === "boolean" ? undefined : `項目「${field.id}」は真偽値が必要です`
  }
}

export const checkValues = (spec: FormSpec, input: unknown): Result.Result<Values, ReadonlyArray<string>> => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return Result.fail(["valuesはオブジェクトが必要です"])
  }
  const record = input as Record<string, unknown>
  const problems = spec.fields
    .map((field) => valueProblem(field, record[field.id]))
    .filter((problem): problem is string => problem !== undefined)
  if (problems.length > 0) {
    return Result.fail(problems)
  }
  return Result.succeed(Object.fromEntries(spec.fields.map((field) => [field.id, record[field.id] as FieldValue])))
}
