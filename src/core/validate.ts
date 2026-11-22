import { Result, Schema } from "effect"
import { references, parse } from "./expression.ts"
import {
  activeFields,
  allFields,
  answerValues,
  isMultiple,
  maxCommentLength,
  maxNoteLength,
  prepare,
  heldFields,
  type Comments,
  type CompiledForm,
  type Values
} from "./form.ts"
import { FormSpec, type ChoiceField, type Field, type NumberField, type RangeField } from "./spec.ts"

const decodeSpec = Schema.decodeUnknownResult(FormSpec, { errors: "all", onExcessProperty: "ignore" })

const maxTotalFields = 40

const duplicateIds = (spec: FormSpec): ReadonlyArray<string> => {
  const ids = [...allFields(spec).map((field) => field.id), ...(spec.computed ?? []).map((item) => item.id)]
  return ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `id「${id}」が重複しています`)
}

const expressionProblems = (spec: FormSpec): ReadonlyArray<string> => {
  const known = new Set(allFields(spec).map((field) => field.id))
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

const totalProblems = (spec: FormSpec): ReadonlyArray<string> => {
  const total = allFields(spec).length
  return total > maxTotalFields ? [`項目が入れ子も含めて${total}個あります。${maxTotalFields}個以下にしてください`] : []
}

const semanticProblems = (spec: FormSpec, input: unknown): ReadonlyArray<string> => [
  ...totalProblems(spec),
  ...duplicateIds(spec),
  ...deepBranches(input),
  ...allFields(spec).flatMap((field) => fieldProblems(field)),
  ...expressionProblems(spec)
]

const records = (value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : []

const deepBranches = (input: unknown): ReadonlyArray<string> =>
  records([input])
    .flatMap((spec) => records(spec["fields"]))
    .flatMap((field) => records(field["options"]))
    .flatMap((option) => records(option["fields"]))
    .filter((nested) => records(nested["options"]).some((option) => "fields" in option))
    .map((nested) => `項目「${String(nested["id"])}」の選択肢にfieldsがあります。選択肢の中の項目は、さらに入れ子にできません`)

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
  const duplicated = new Set(defaults).size === defaults.length ? [] : [`項目「${field.id}」のdefaultが重複しています`]
  return [
    ...shape,
    ...duplicated,
    ...defaults.filter((value) => !values.has(value)).map((value) => `項目「${field.id}」のdefault「${value}」が選択肢にありません`)
  ]
}

const choiceProblems = (field: ChoiceField): ReadonlyArray<string> => {
  const values = new Set(field.options.map((option) => option.value))
  const duplicated = values.size === field.options.length ? [] : [`項目「${field.id}」の選択肢のvalueが重複しています`]
  const branched =
    isMultiple(field) && field.options.some((option) => option.fields !== undefined)
      ? [`項目「${field.id}」は複数選択なので、選択肢にfieldsを付けられません`]
      : []
  return [...duplicated, ...branched, ...choiceDefaultProblems(field, values)]
}

const isRangeValue = (value: unknown, field: RangeField): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((bound) => typeof bound === "number" && Number.isFinite(bound)) &&
  field.min <= value[0] &&
  value[0] <= value[1] &&
  value[1] <= field.max

const rangeProblems = (field: RangeField): ReadonlyArray<string> => {
  if (field.min >= field.max) {
    return [`項目「${field.id}」のminがmax以上です`]
  }
  return field.default === undefined || isRangeValue(field.default, field)
    ? []
    : [`項目「${field.id}」のdefaultは、${field.min}〜${field.max}の範囲で[下限, 上限]の順にしてください`]
}

const reasonProblems = (field: Field): ReadonlyArray<string> =>
  field.default === undefined && (field.reason !== undefined || field.reasonDetails !== undefined)
    ? [`項目「${field.id}」はdefaultがないので、reasonとreasonDetailsを付けられません。質問の説明はdescriptionに書いてください`]
    : []

const typeProblems = (field: Field): ReadonlyArray<string> => {
  switch (field.type) {
    case "number":
      return numberProblems(field)
    case "choice":
      return choiceProblems(field)
    case "range":
      return rangeProblems(field)
    default:
      return []
  }
}

const fieldProblems = (field: Field): ReadonlyArray<string> => [...reasonProblems(field), ...typeProblems(field)]

export const compile = (input: unknown): Result.Result<CompiledForm, ReadonlyArray<string>> => {
  const decoded = decodeSpec(input)
  if (Result.isFailure(decoded)) {
    return Result.fail([decoded.failure.message])
  }
  const spec = decoded.success
  const problems = semanticProblems(spec, input)
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
    return Array.isArray(value) &&
      new Set(value).size === value.length &&
      value.every((item) => typeof item === "string" && allowed.has(item))
      ? undefined
      : `項目「${field.id}」は重複のない選択肢の配列が必要です`
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
    case "range":
      return isRangeValue(value, field) ? undefined : `項目「${field.id}」は、${field.min}〜${field.max}の範囲の[下限, 上限]が必要です`
  }
}

const checkHeld = (spec: FormSpec, values: Values, input: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(input) || input.some((id) => typeof id !== "string")) {
    return ["heldは項目のidの配列が必要です"]
  }
  const declared = new Set(input as ReadonlyArray<string>)
  const actual = new Set(heldFields(spec, values))
  return [
    ...[...actual].filter((id) => !declared.has(id)).map((id) => `項目「${id}」は値か、heldが必要です`),
    ...[...declared]
      .filter((id) => !actual.has(id))
      .map((id) => `項目「${id}」はheldにできません。値があるか、選ばれていない選択肢の項目です`)
  ]
}

const checkComments = (spec: FormSpec, values: Values, input: unknown): Result.Result<Comments, ReadonlyArray<string>> => {
  if (input === undefined) {
    return Result.succeed({})
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return Result.fail(["commentsは項目のidから文字列への対応が必要です"])
  }
  const active = new Set(activeFields(spec, values).map((field) => field.id))
  const entries = Object.entries(input as Record<string, unknown>)
  const problems = entries.flatMap(([id, comment]) => [
    ...(active.has(id) ? [] : [`項目「${id}」にはコメントを付けられません。有効な項目ではありません`]),
    ...(typeof comment === "string" && comment.length <= maxCommentLength
      ? []
      : [`項目「${id}」のコメントは${maxCommentLength}文字以下の文字列が必要です`])
  ])
  if (problems.length > 0) {
    return Result.fail(problems)
  }
  return Result.succeed(
    Object.fromEntries(entries.map(([id, comment]) => [id, String(comment).trim()]).filter(([, comment]) => comment !== ""))
  )
}

const checkNote = (input: unknown): Result.Result<string, ReadonlyArray<string>> => {
  const note = input ?? ""
  if (typeof note !== "string" || note.length > maxNoteLength) {
    return Result.fail([`noteは${maxNoteLength}文字以下の文字列が必要です`])
  }
  return Result.succeed(note.trim())
}

export const checkValues = (spec: FormSpec, input: unknown): Result.Result<Values, ReadonlyArray<string>> => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return Result.fail(["valuesはオブジェクトが必要です"])
  }
  const record = input as Record<string, unknown>
  const problems = activeFields(spec, record as Values)
    .filter((field) => record[field.id] !== undefined)
    .map((field) => valueProblem(field, record[field.id]))
    .filter((problem): problem is string => problem !== undefined)
  if (problems.length > 0) {
    return Result.fail(problems)
  }
  return Result.succeed(answerValues(spec, record as Values))
}

export interface Answer {
  readonly values: Values
  readonly comments: Comments
  readonly note: string | undefined
}

const failures = (...results: ReadonlyArray<Result.Result<unknown, ReadonlyArray<string>>>): ReadonlyArray<string> =>
  results.flatMap((result) => (Result.isFailure(result) ? result.failure : []))

export const checkAnswer = (spec: FormSpec, input: Readonly<Record<string, unknown>>): Result.Result<Answer, ReadonlyArray<string>> => {
  const values = checkValues(spec, input["values"])
  const note = checkNote(input["note"])
  if (Result.isFailure(values)) {
    return Result.fail(failures(values, note))
  }
  const comments = checkComments(spec, values.success, input["comments"])
  const held = [
    ...checkHeld(spec, values.success, input["held"] ?? []),
    ...(Result.isSuccess(comments)
      ? heldFields(spec, values.success)
          .filter((id) => comments.success[id] === undefined)
          .map((id) => `項目「${id}」は値がないので、コメントが必要です`)
      : [])
  ]
  if (held.length === 0 && Result.isSuccess(comments) && Result.isSuccess(note)) {
    return Result.succeed({ values: values.success, comments: comments.success, note: note.success === "" ? undefined : note.success })
  }
  return Result.fail([...held, ...failures(comments, note)])
}
