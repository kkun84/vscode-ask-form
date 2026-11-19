import { Context, Effect, Layer, Result, Schema } from "effect"
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai"
import { outcomeFor, outcomeText, type Action, type Outcome } from "../core/form.ts"
import { checkAnswer, compile, type Answer } from "../core/validate.ts"
import { PendingForms } from "./pending.ts"
import { formSpecJsonSchema } from "./schema.ts"
import { FormPanel, UserPresence } from "./ports.ts"

export const resourceUri = "ui://ask-form/form.html"
export const resourceMimeType = "text/html;profile=mcp-app"

const appsExtension = "io.modelcontextprotocol/ui"

const showsApps = (capabilities: McpSchema.ClientCapabilities): boolean => {
  const settings = capabilities.extensions?.[appsExtension]
  if (typeof settings !== "object" || settings === null) {
    return false
  }
  const mimeTypes = (settings as { readonly mimeTypes?: unknown }).mimeTypes
  return Array.isArray(mimeTypes) && mimeTypes.includes(resourceMimeType)
}

export class FormHtml extends Context.Service<FormHtml, string>()("ask-form/FormHtml") {}

class FormRejected extends Schema.TaggedError<FormRejected, { readonly brand: unique symbol }>()("FormRejected", {
  message: Schema.String
}) {}

const FieldValue = Schema.Union([Schema.String, Schema.Finite, Schema.Array(Schema.String)])
const Values = Schema.Record(Schema.String, FieldValue)
const ComputedValues = Schema.Record(Schema.String, Schema.NullOr(Schema.Union([Schema.Finite, Schema.String, Schema.Boolean])))

const OutcomeResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("submitted"),
    values: Values,
    held: Schema.Array(Schema.String),
    changedByUser: Schema.Array(Schema.String),
    computed: ComputedValues,
    note: Schema.optionalKey(Schema.String),
    next: Schema.String
  }),
  Schema.Struct({ status: Schema.Literals(["answer_in_chat", "unavailable"]), next: Schema.String })
])

const withNext = (outcome: Outcome): typeof OutcomeResult.Type => ({ ...outcome, next: outcomeText(outcome) })

export const askFormDescription = [
  "Ask the user a question through an interactive form shown in the chat, and wait for the answer.",
  "Whenever you need to ask the user something, use this tool instead of a built-in question tool (such as askQuestions, ask_user, AskUserQuestion or request_user_input) or a question in your chat reply, even for a single choice.",
  "Ask only when the answer materially changes the work, and put the related questions into one form. Use computed for values whose consequences the user should see.",
  "Set default only when the workspace or conversation gives you grounds to recommend a value; otherwise leave it out and the user must choose.",
  "Use reason only together with default: for a choice, why that option fits best here; for other fields, advice that helps the user decide. Without a default, reason is rejected; put the explanation in description.",
  "Give every option a description of what it is or what happens if chosen, and give a field a description when its meaning is not obvious.",
  "For a yes/no question, use a choice with two options.",
  "When some fields only matter for one option of a single-select choice, put them in that option's fields instead of asking separately; the answer then contains only the chosen option's fields.",
  "Write labels in the user's language. Never ask for secrets or credentials.",
  "Do not use it when the user asked you to work autonomously.",
  "The user can put any question on hold instead of answering it; those ids come back in held without a value, and you ask again when you need one.",
  "The user can also add a free-form note to the answers, for example an answer that is not among your options; it comes back in note.",
  "The result tells you whether the user submitted values, cancelled the form to answer in chat, or is unavailable so the form was not shown or was withdrawn."
].join(" ")

const AskForm = Tool.dynamic("ask_form", {
  description: askFormDescription,
  parameters: formSpecJsonSchema,
  success: OutcomeResult,
  failure: FormRejected
})
  .addDependency(McpSchema.McpRequestContext)
  .annotate(Tool.Title, "Ask with a form")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(Tool.Meta, { ui: { resourceUri } })

const FormAnswer = Tool.make("form_answer", {
  description: "Deliver the user's answer from the form view. Only the form view calls this tool.",
  parameters: Schema.Struct({
    formKey: Schema.String,
    action: Schema.Literals(["submit", "chat"]),
    values: Schema.optionalKey(Schema.Unknown),
    held: Schema.optionalKey(Schema.Unknown),
    note: Schema.optionalKey(Schema.Unknown)
  }),
  success: Schema.Struct({ accepted: Schema.Boolean }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormStatus = Tool.make("form_status", {
  description: "Check whether the form is still waiting or was cancelled. Only the form view calls this tool.",
  parameters: Schema.Struct({ formKey: Schema.String }),
  success: Schema.Struct({ status: Schema.Literals(["pending", "answered", "cancelled", "unknown"]) })
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormsToolkit = Toolkit.make(AskForm, FormAnswer, FormStatus)

const reject = (problems: ReadonlyArray<string>) => Effect.fail(new FormRejected({ message: problems.join("\n") }))

const FormsHandlers = FormsToolkit.toLayer(
  Effect.gen(function* () {
    const pending = yield* PendingForms
    const presence = yield* UserPresence
    const panel = yield* FormPanel
    return FormsToolkit.of({
      form_status: ({ formKey }) => pending.status(formKey).pipe(Effect.map((status) => ({ status }))),
      ask_form: (params) =>
        Effect.gen(function* () {
          const compiled = compile(params)
          if (Result.isFailure(compiled)) {
            return yield* reject(compiled.failure)
          }
          if (yield* presence.unavailable) {
            return withNext({ status: "unavailable" })
          }
          const left = presence.away.pipe(Effect.as<Outcome>({ status: "unavailable" }))
          const client = yield* McpSchema.McpRequestContext
          const asked = showsApps(client.clientCapabilities)
            ? pending.wait(compiled.success)
            : panel.ask(compiled.success, params as Readonly<Record<string, unknown>>)
          return withNext(yield* Effect.raceFirst(asked, left))
        }),
      form_answer: ({ formKey, action, values, held, note }) =>
        Effect.gen(function* () {
          const form = yield* pending.peek(formKey)
          if (form === undefined) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          let answer: Answer = { values: {}, note: undefined }
          if (action === "submit") {
            const result = checkAnswer(form.spec, { values, held, note })
            if (Result.isFailure(result)) {
              return yield* reject(result.failure)
            }
            answer = result.success
          }
          const accepted = yield* pending.resolve(formKey, (latest) => outcomeFor(latest, action as Action, answer.values, answer.note))
          if (!accepted) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          return { accepted }
        })
    })
  })
)

const FormResource = Layer.unwrap(
  Effect.gen(function* () {
    const html = yield* FormHtml
    return McpServer.resource({
      uri: resourceUri,
      name: "Ask Form",
      description: "Interactive form view for ask_form",
      mimeType: resourceMimeType,
      content: Schema.decodeEffect(McpSchema.ReadResourceResult)({
        contents: [{ uri: resourceUri, mimeType: resourceMimeType, text: html }]
      }).pipe(Effect.orDie)
    })
  })
)

export const FormsServer = Layer.mergeAll(McpServer.toolkit(FormsToolkit), FormResource).pipe(Layer.provide(FormsHandlers))
