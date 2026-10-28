import { Schema } from "effect"
import { FormSpec } from "../core/spec.ts"

const inlineRefs = (value: unknown, definitions: Readonly<Record<string, unknown>>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => inlineRefs(item, definitions))
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    const ref = record["$ref"]
    if (typeof ref === "string") {
      return inlineRefs(definitions[ref.split("/").at(-1) ?? ""], definitions)
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, inlineRefs(item, definitions)]))
  }
  return value
}

const document = Schema.toJsonSchemaDocument(FormSpec)

export const formSpecJsonSchema = inlineRefs(document.schema, document.definitions) as {
  readonly type: "object"
  readonly properties: Readonly<Record<string, unknown>>
}
