import { evaluate, parse, type Expr, type Scope, type Value } from "./expression.ts"
import { stableHash } from "./hash.ts"
import type { Messages } from "./messages.ts"
import type { ChoiceField, Computed, Field, FormSpec } from "./spec.ts"

export type FieldValue = string | number | boolean | ReadonlyArray<string>
export type Values = Readonly<Record<string, FieldValue>>
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

export const answerValues = (spec: FormSpec, values: Values): Values =>
  Object.fromEntries(
    activeFields(spec, values).flatMap((field) => (values[field.id] === undefined ? [] : [[field.id, values[field.id] as FieldValue]]))
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

const initialValue = (field: Field): FieldValue => {
  switch (field.type) {
    case "text":
      return field.default ?? ""
    case "number":
      return field.default ?? field.min
    case "choice":
      return field.default ?? (isMultiple(field) ? [] : (field.options[0]?.value ?? ""))
  }
}

export const initialValues = (spec: FormSpec): Values => Object.fromEntries(allFields(spec).map((field) => [field.id, initialValue(field)]))

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

export const changedFields = (spec: FormSpec, before: Values, after: Values): ReadonlyArray<string> =>
  activeFields(spec, after)
    .filter((field) => !sameValue(before[field.id], after[field.id]))
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

export const resendMessage = (spec: FormSpec, before: Values, after: Values, m: Messages): string | undefined => {
  const changed = changedFields(spec, before, after)
  if (changed.length === 0) {
    return undefined
  }
  const parts = activeFields(spec, after)
    .filter((field) => changed.includes(field.id))
    .map((field) => m.changeTo(field.label, describeValue(field, after[field.id], m)))
  return m.resendSentence(parts, spec.title)
}

export type Outcome =
  | {
      readonly status: "submitted"
      readonly values: Values
      readonly changedByUser: ReadonlyArray<string>
      readonly computed: ComputedValues
    }
  | { readonly status: "delegated"; readonly values: Values; readonly computed: ComputedValues }
  | { readonly status: "answer_in_chat" }

export type Action = "submit" | "delegate" | "chat"

export const outcomeFor = (form: CompiledForm, action: Action, values: Values): Outcome => {
  switch (action) {
    case "submit":
      return {
        status: "submitted",
        values,
        changedByUser: changedFields(form.spec, initialValues(form.spec), values),
        computed: computeValues(form, values)
      }
    case "delegate": {
      const defaults = answerValues(form.spec, initialValues(form.spec))
      return { status: "delegated", values: defaults, computed: computeValues(form, defaults) }
    }
    case "chat":
      return { status: "answer_in_chat" }
  }
}

export const outcomeText = (outcome: Outcome): string => {
  const json = JSON.stringify(outcome)
  switch (outcome.status) {
    case "submitted":
      return `The user submitted the form. Treat fields listed in changedByUser as explicit decisions and the rest as accepted defaults. Continue the task.\n${json}`
    case "delegated":
      return `The user asked you to decide. Proceed with your proposed defaults and mention them briefly.\n${json}`
    case "answer_in_chat":
      return `The user will answer in the chat instead. End your turn now and wait for the user's next message.\n${json}`
  }
}

export const attachmentName = (title: string): string => {
  const normalized = title.replaceAll(/[^\p{L}\p{N}]+/gu, "-").replaceAll(/^-|-$/g, "")
  const slug = [...normalized].slice(0, 40).join("")
  return `${slug === "" ? "form" : slug}.json`
}
