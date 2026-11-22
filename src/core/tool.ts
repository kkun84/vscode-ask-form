import { Schema } from "effect"
import { FormSpec } from "./spec.ts"

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

export const askFormDescription = [
  "Ask the user a question through an interactive form shown in a panel beside the chat, and wait for the answer.",
  "Whenever you need to ask the user something, use this tool instead of a built-in question tool (such as askQuestions, ask_user, AskUserQuestion or request_user_input) or a question in your chat reply, even for a single choice.",
  "Ask only when the answer materially changes the work, and put the related questions into one form. Use computed for values whose consequences the user should see.",
  "Set default only when the workspace or conversation gives you grounds to recommend a value; otherwise leave it out and the user must choose.",
  "Use reason only together with default: for a choice, why that option fits best here; for other fields, advice that helps the user decide. Without a default, reason is rejected; put the explanation in description.",
  "Give every option a description of what it is or what happens if chosen, and give a field a description when its meaning is not obvious.",
  "For a yes/no question, use a choice with two options. To ask for a span with a lower and an upper bound, such as supported versions or a budget, use a range field.",
  "When some fields only matter for one option of a single-select choice, put them in that option's fields instead of asking separately; the answer then contains only the chosen option's fields.",
  "Write labels in the user's language. Never ask for secrets or credentials.",
  "Do not use it when the user asked you to work autonomously.",
  "The user can leave a question without a value by commenting on it instead; its id comes back in held, the comment says what to do, and heldForm holds those fields for asking again.",
  "The user can comment on each question; comments come back in comments, keyed by field id.",
  "The user can also add a free-form note to the answers, for example an answer that is not among your options; it comes back in note.",
  "The result tells you whether the user submitted values, cancelled the form to answer in chat, or is unavailable so the form was not shown or was withdrawn."
].join(" ")
