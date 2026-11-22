import { Result, Schema } from "effect"
import { references, parse } from "./expression.ts"
import {
  activeFields,
  allFields,
  answerValues,
  isMultiple,
  maxCommentLength,
  maxListItemLength,
  maxListItems,
  maxNoteLength,
  prepare,
  heldFields,
  treeAncestors,
  treeNodes,
  type Comments,
  type CompiledForm,
  type Values
} from "./form.ts"
import { FormSpec, type ChoiceField, type Field, type NumberField, type RankingField } from "./spec.ts"
import { FormSpec, type ChoiceField, type Field, type NumberField, type NumberRangeField } from "./spec.ts"
import { FormSpec, type ChoiceField, type Field, type TextListField, type NumberField } from "./spec.ts"
import { FormSpec, type ChoiceField, type DateField, type Field, type NumberField, type TimeField } from "./spec.ts"
import { FormSpec, type ChoiceField, type Field, type NumberField, type TreeChoiceField } from "./spec.ts"

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
  ...deepTrees(input),
  ...allFields(spec).flatMap((field) => fieldProblems(field)),
  ...expressionProblems(spec)
]

const records = (value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : []

const topFields = (input: unknown) => records([input]).flatMap((spec) => records(spec["fields"]))

const optionFields = (fields: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
  fields.flatMap((field) => records(field["options"])).flatMap((option) => records(option["fields"]))

const deepBranches = (input: unknown): ReadonlyArray<string> =>
  optionFields(topFields(input))
    .filter((nested) => records(nested["options"]).some((option) => "fields" in option))
    .map((nested) => `項目「${String(nested["id"])}」の選択肢にfieldsがあります。選択肢の中の項目は、さらに入れ子にできません`)

const maxTreeDepth = 4

const treeDepth = (nodes: unknown): number =>
  records(nodes).reduce((deepest, node) => Math.max(deepest, 1 + treeDepth(node["children"])), 0)

const deepTrees = (input: unknown): ReadonlyArray<string> =>
  [topFields(input), optionFields(topFields(input))]
    .flat()
    .filter((field) => field["type"] === "treeChoice" && treeDepth(field["nodes"]) > maxTreeDepth)
    .map((field) => `項目「${String(field["id"])}」の木が${maxTreeDepth}段より深くなっています`)

const numberProblems = (field: NumberField): ReadonlyArray<string> => {
  if (field.min >= field.max) {
    return [`項目「${field.id}」のminがmax以上です`]
  }
  const outside = field.default !== undefined && (field.default < field.min || field.default > field.max)
  return outside ? [`項目「${field.id}」のdefaultが${field.min}〜${field.max}の範囲外です`] : []
}

const choiceDefaultProblems = (field: ChoiceField | TreeChoiceField, values: ReadonlySet<string>): ReadonlyArray<string> => {
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

const rankBounds = (field: RankingField): readonly [number, number] => [field.min ?? 1, field.max ?? field.options.length]

const isRanking = (value: unknown, field: RankingField): boolean => {
  const allowed = new Set(field.options.map((option) => option.value))
  const [min, max] = rankBounds(field)
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.has(item))
  )
}

const rankingProblems = (field: RankingField): ReadonlyArray<string> => {
  const values = field.options.map((option) => option.value)
  const [min, max] = rankBounds(field)
  const duplicated = new Set(values).size === values.length ? [] : [`項目「${field.id}」の選択肢のvalueが重複しています`]
  const bounds = min <= max && max <= values.length ? [] : [`項目「${field.id}」のminとmaxは、1≦min≦max≦選択肢の数にしてください`]
  const order =
    field.default === undefined || isRanking(field.default, field)
      ? []
      : [`項目「${field.id}」のdefaultは、選択肢のvalueを重複なく${min}〜${max}個並べた配列にしてください`]
  return [...duplicated, ...bounds, ...order]
const isRangeValue = (value: unknown, field: NumberRangeField): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((bound) => typeof bound === "number" && Number.isFinite(bound)) &&
  field.min <= value[0] &&
  value[0] <= value[1] &&
  value[1] <= field.max

const rangeProblems = (field: NumberRangeField): ReadonlyArray<string> => {
  if (field.min >= field.max) {
    return [`項目「${field.id}」のminがmax以上です`]
  }
  return field.default === undefined || isRangeValue(field.default, field)
    ? []
    : [`項目「${field.id}」のdefaultは、${field.min}〜${field.max}の範囲で[下限, 上限]の順にしてください`]
}
const isList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length <= maxListItems &&
  new Set(value).size === value.length &&
  value.every((item) => typeof item === "string" && item.trim() !== "" && item.length <= maxListItemLength)

const listProblems = (field: TextListField): ReadonlyArray<string> =>
  field.default === undefined || new Set(field.default).size === field.default.length
    ? []
    : [`項目「${field.id}」のdefaultが重複しています`]
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

const minutesOf = (value: unknown): number | undefined => {
  const match = typeof value === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) : null
  return match === null ? undefined : Number(match[1]) * 60 + Number(match[2])
}

const dateProblem = (field: DateField, value: unknown): string | undefined => {
  if (!isDate(value)) {
    return `項目「${field.id}」はYYYY-MM-DDの形の、存在する日付が必要です`
  }
  return (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)
    ? `項目「${field.id}」が範囲外です`
    : undefined
}

const timeProblem = (field: TimeField, value: unknown): string | undefined => {
  const minutes = minutesOf(value)
  if (minutes === undefined) {
    return `項目「${field.id}」は24時間のHH:MMの形の時刻が必要です`
  }
  const min = minutesOf(field.min) ?? 0
  const max = minutesOf(field.max) ?? 24 * 60 - 1
  if (minutes < min || minutes > max) {
    return `項目「${field.id}」が範囲外です`
  }
  return field.step !== undefined && (minutes - min) % field.step !== 0
    ? `項目「${field.id}」は${field.step}分刻みの時刻が必要です`
    : undefined
}

const bounded = (
  id: string,
  min: string | undefined,
  max: string | undefined,
  valid: (value: string) => boolean
): ReadonlyArray<string> => [
  ...[min, max]
    .filter((value): value is string => value !== undefined && !valid(value))
    .map((value) => `項目「${id}」の「${value}」は存在しません`),
  ...(min !== undefined && max !== undefined && min >= max ? [`項目「${id}」のminがmax以上です`] : [])
]

const withDefault = (
  range: ReadonlyArray<string>,
  fallback: string | undefined,
  check: () => string | undefined
): ReadonlyArray<string> => {
  if (range.length > 0 || fallback === undefined) {
    return range
  }
  const problem = check()
  return problem === undefined ? [] : [`${problem}(default)`]
}

const dateFieldProblems = (field: DateField): ReadonlyArray<string> =>
  withDefault(bounded(field.id, field.min, field.max, isDate), field.default, () => dateProblem(field, field.default))

const timeFieldProblems = (field: TimeField): ReadonlyArray<string> =>
  withDefault(
    bounded(field.id, field.min, field.max, (value) => minutesOf(value) !== undefined),
    field.default,
    () => timeProblem(field, field.default)
  )

const maxTreeNodes = 100

const treeProblems = (field: TreeChoiceField): ReadonlyArray<string> => {
  const nodes = treeNodes(field.nodes)
  const values = new Set(nodes.map((node) => node.value))
  const defaults = field.default === undefined ? [] : typeof field.default === "string" ? [field.default] : field.default
  const nested = isMultiple(field)
    ? defaults.filter((value) => treeAncestors(field.nodes, [value]).some((ancestor) => defaults.includes(ancestor)))
    : []
  return [
    ...(nodes.length > maxTreeNodes
      ? [`項目「${field.id}」の木の項目が${nodes.length}個あります。${maxTreeNodes}個以下にしてください`]
      : []),
    ...(values.size === nodes.length ? [] : [`項目「${field.id}」の木のvalueが重複しています`]),
    ...choiceDefaultProblems(field, values),
    ...nested.map((value) => `項目「${field.id}」のdefault「${value}」は、祖先がdefaultにあるので要りません`)
  ]
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
    case "ranking":
      return rankingProblems(field)
    case "numberRange":
      return rangeProblems(field)
    case "textList":
      return listProblems(field)
    case "date":
      return dateFieldProblems(field)
    case "time":
      return timeFieldProblems(field)
    case "treeChoice":
      return treeProblems(field)
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

const choiceProblem = (field: ChoiceField | TreeChoiceField, value: unknown): string | undefined => {
  const allowed = new Set((field.type === "choice" ? field.options : treeNodes(field.nodes)).map((option) => option.value))
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
    case "treeChoice":
      return choiceProblem(field, value)
    case "ranking":
      return isRanking(value, field)
        ? undefined
        : `項目「${field.id}」は、選択肢のvalueを重複なく${rankBounds(field).join("〜")}個並べた配列が必要です`
    case "numberRange":
      return isRangeValue(value, field) ? undefined : `項目「${field.id}」は、${field.min}〜${field.max}の範囲の[下限, 上限]が必要です`
    case "textList":
      return isList(value)
        ? undefined
        : `項目「${field.id}」は、${maxListItemLength}文字以下の空でない文字列を重複なく${maxListItems}個まで並べた配列が必要です`
    case "date":
      return dateProblem(field, value)
    case "time":
      return timeProblem(field, value)
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
