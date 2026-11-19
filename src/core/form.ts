import { evaluate, parse, type Expr, type Scope, type Value } from "./expression.ts"
import { stableHash } from "./hash.ts"
import type { Messages } from "./messages.ts"
import type { ChoiceField, Computed, Field, FormSpec } from "./spec.ts"

export type FieldValue = string | number | ReadonlyArray<string>
export type Values = Readonly<Record<string, FieldValue>>
export type Comments = Readonly<Record<string, string>>
export type ComputedValues = Readonly<Record<string, Value | null>>

export interface CompiledForm {
  readonly spec: FormSpec
  readonly key: string
  readonly expressions: ReadonlyMap<string, Expr>
}

export const isMultiple = (field: ChoiceField): boolean => field.multiple === true

const branchFields = (field: Field, value: FieldValue | undefined): ReadonlyArray<Field> =>
  field.type === "choice" && !isMultiple(field) ? (field.options.find((option) => option.value === value)?.fields ?? []) : []

export const allFields = (spec: FormSpec): ReadonlyArray<Field> =>
  spec.fields.flatMap((field) => [field, ...(field.type === "choice" ? field.options.flatMap((option) => option.fields ?? []) : [])])

export const activeFields = (spec: FormSpec, values: Values): ReadonlyArray<Field> =>
  spec.fields.flatMap((field) => [field, ...branchFields(field, values[field.id])])

const filled = (fields: ReadonlyArray<Field>, values: Values): Values =>
  Object.fromEntries(fields.flatMap((field) => (values[field.id] === undefined ? [] : [[field.id, values[field.id] as FieldValue]])))

export const answerValues = (spec: FormSpec, values: Values): Values => filled(activeFields(spec, values), values)

export const heldFields = (spec: FormSpec, values: Values): ReadonlyArray<string> =>
  activeFields(spec, values)
    .filter((field) => values[field.id] === undefined)
    .map((field) => field.id)

export const commentsFor = (spec: FormSpec, values: Values, comments: Comments): Comments =>
  Object.fromEntries(
    activeFields(spec, values).flatMap((field) => {
      const comment = comments[field.id]?.trim() ?? ""
      return comment === "" ? [] : [[field.id, comment]]
    })
  )

const parseExpressions = (spec: FormSpec): ReadonlyMap<string, Expr> => {
  const expressions = new Map<string, Expr>()
  for (const item of spec.computed ?? []) {
    const result = parse(item.expression)
    if (result.ok) {
      expressions.set(item.id, result.expr)
    }
  }
  return expressions
}

export const prepare = (spec: FormSpec, raw: unknown): CompiledForm => ({
  spec,
  key: stableHash(raw),
  expressions: parseExpressions(spec)
})

const initialValue = (field: Field): FieldValue | undefined => {
  switch (field.type) {
    case "text":
      return field.default ?? ""
    case "number":
      return field.default
    case "choice":
      return field.default ?? (isMultiple(field) ? [] : undefined)
  }
}

export const initialValues = (spec: FormSpec): Values =>
  Object.fromEntries(
    allFields(spec).flatMap((field) => {
      const value = initialValue(field)
      return value === undefined ? [] : [[field.id, value]]
    })
  )

export const unansweredFields = (spec: FormSpec, values: Values, held: ReadonlySet<string> = new Set()): ReadonlyArray<Field> =>
  activeFields(spec, values).filter((field) => values[field.id] === undefined && !held.has(field.id))

const scopeValue = (field: Field, value: FieldValue | undefined): Value | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (field.type === "choice" && isMultiple(field)) {
    return Array.isArray(value) ? value.length : undefined
  }
  return Array.isArray(value) ? undefined : (value as Value)
}

export const computeValues = (form: CompiledForm, values: Values): ComputedValues => {
  const scope = new Map<string, Value | undefined>()
  for (const field of activeFields(form.spec, values)) {
    scope.set(field.id, scopeValue(field, values[field.id]))
  }
  return Object.fromEntries(
    (form.spec.computed ?? []).map((item) => {
      const expr = form.expressions.get(item.id)
      const value = expr === undefined ? undefined : evaluate(expr, scope as Scope)
      scope.set(item.id, value)
      return [item.id, value ?? null]
    })
  )
}

const sameValue = (a: FieldValue | undefined, b: FieldValue | undefined): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    const sortedB = b.toSorted()
    return a.length === b.length && a.toSorted().every((value, index) => value === sortedB[index])
  }
  return a === b
}

export interface Answered {
  readonly values: Values
  readonly comments?: Comments
}

const sameAnswer = (id: string, before: Answered, after: Answered): boolean => sameValue(before.values[id], after.values[id])

export const changedFields = (spec: FormSpec, before: Values, after: Values): ReadonlyArray<string> =>
  activeFields(spec, after)
    .filter((field) => !sameValue(before[field.id], after[field.id]))
    .map((field) => field.id)

export const changedAnswers = (spec: FormSpec, before: Answered, after: Answered): ReadonlyArray<string> =>
  activeFields(spec, after.values)
    .filter(
      (field) =>
        !sameAnswer(field.id, before, after) || (before.comments?.[field.id]?.trim() ?? "") !== (after.comments?.[field.id]?.trim() ?? "")
    )
    .map((field) => field.id)

const affixed = (text: string, prefix: string | undefined, suffix: string | undefined): string => `${prefix ?? ""}${text}${suffix ?? ""}`

export const formatNumber = (value: number, decimals?: number): string =>
  value.toLocaleString(
    "en-US",
    decimals === undefined
      ? { maximumFractionDigits: 4 }
      : {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }
  )

export const describeValue = (field: Field, value: FieldValue | undefined, m: Messages): string => {
  if (value === undefined) {
    return m.held
  }
  switch (field.type) {
    case "text":
      return typeof value === "string" && value !== "" ? value : m.empty
    case "number":
      return typeof value === "number" ? affixed(formatNumber(value), field.prefix, field.suffix) : "—"
    case "choice": {
      const selected = Array.isArray(value) ? value : value === undefined ? [] : [value]
      const labels = selected.map((item) => field.options.find((option) => option.value === item)?.label ?? String(item))
      return labels.length === 0 ? m.none : labels.join(m.listSeparator)
    }
  }
}

export const describeComputed = (item: Computed, value: Value | null | undefined, m: Messages): string => {
  if (value === null || value === undefined) {
    return "—"
  }
  if (typeof value === "number") {
    return affixed(formatNumber(value, item.decimals), item.prefix, item.suffix)
  }
  if (typeof value === "boolean") {
    return value ? m.yes : m.no
  }
  return affixed(value, item.prefix, item.suffix)
}

const changePart = (field: Field, before: Answered, after: Answered, m: Messages): string => {
  const comment = after.comments?.[field.id]?.trim() || undefined
  if (sameAnswer(field.id, before, after)) {
    return m.commentTo(field.label, comment)
  }
  const value = after.values[field.id]
  const text = value === undefined ? m.onHold : describeValue(field, value, m)
  return m.changeTo(field.label, `${text}${comment === undefined ? "" : m.withComment(comment)}`)
}

export const resendMessage = (spec: FormSpec, before: Answered, after: Answered, m: Messages): string | undefined => {
  const changed = changedAnswers(spec, before, after)
  if (changed.length === 0) {
    return undefined
  }
  const parts = activeFields(spec, after.values)
    .filter((field) => changed.includes(field.id))
    .map((field) => changePart(field, before, after, m))
  return m.resendSentence(parts, spec.title)
}

export interface HeldForm {
  readonly title: string
  readonly fields: ReadonlyArray<Field>
}

const heldForm = (spec: FormSpec, held: ReadonlyArray<string>): HeldForm => ({
  title: spec.title,
  fields: allFields(spec).filter((field) => held.includes(field.id))
})

export type Outcome =
  | {
      readonly status: "submitted"
      readonly values: Values
      readonly held: ReadonlyArray<string>
      readonly changedByUser: ReadonlyArray<string>
      readonly computed: ComputedValues
      readonly comments?: Comments
      readonly heldForm?: HeldForm
      readonly note?: string
    }
  | { readonly status: "answer_in_chat" }
  | { readonly status: "unavailable" }

export const maxNoteLength = 2000

export const maxCommentLength = 500

const maxCommentPresets = 8

export const commentPresetsFrom = (input: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(input)
    ? input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item !== "" && item.length <= maxCommentLength)
        .slice(0, maxCommentPresets)
    : undefined

export type Action = "submit" | "chat"

export interface AnswerInput {
  readonly values: Values
  readonly comments?: Comments
  readonly note?: string | undefined
}

export const outcomeFor = (form: CompiledForm, action: Action, answer: AnswerInput): Outcome => {
  switch (action) {
    case "submit": {
      const { values, note } = answer
      const held = heldFields(form.spec, values)
      const comments = commentsFor(form.spec, values, answer.comments ?? {})
      return {
        status: "submitted",
        values,
        held,
        changedByUser: changedFields(form.spec, initialValues(form.spec), values).filter((id) => values[id] !== undefined),
        computed: computeValues(form, values),
        ...(Object.keys(comments).length === 0 ? {} : { comments }),
        ...(held.length === 0 ? {} : { heldForm: heldForm(form.spec, held) }),
        ...(note === undefined ? {} : { note })
      }
    }
    case "chat":
      return { status: "answer_in_chat" }
  }
}

export const outcomeText = (outcome: Outcome): string => {
  const json = JSON.stringify(outcome)
  switch (outcome.status) {
    case "submitted":
      return `The user submitted the form. Treat fields listed in changedByUser as explicit decisions and the rest of values as accepted recommendations. An empty string in values means the user deliberately left that field blank. comments maps field ids to comments the user wrote on those questions: follow each for its field, over the value if they contradict. Fields listed in held have no value: the user did not answer them, and their comment says why or what to do, for example to ask later, to let you decide, or that the question does not matter. If it lets you decide, choose a value and tell the user what you chose and why. If it says the question does not matter, drop it. Otherwise do not assume a value; continue with the work that does not depend on it, and when you need one, ask again with ask_form, starting from heldForm (the original definitions of the held fields) and updating it with what you have learned. If note is present, it is a message the user wrote to go with the answers: follow it over any value it contradicts, and use it when it answers a held field. Continue the task.\n${json}`
    case "answer_in_chat":
      return `The user cancelled the form without answering and will respond in the chat instead. End your turn now and wait for the user's next message.\n${json}`
    case "unavailable":
      return `The form was not shown, or was withdrawn while it waited: the user turned on the chat.autoReply setting, so they are not available to answer and will review your work later. Do not ask these questions again in this turn. Continue with the values you recommended as defaults; where you gave no default, use your best judgment and tell the user which assumptions you made.\n${json}`
  }
}

export const attachmentName = (title: string): string => {
  const normalized = title.replaceAll(/[^\p{L}\p{N}]+/gu, "-").replaceAll(/^-|-$/g, "")
  const slug = [...normalized].slice(0, 40).join("")
  return `${slug === "" ? "form" : slug}.json`
}
