import { Context, Effect, Layer, Result, Schema } from "effect"
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai"
import { outcomeFor, outcomeText, resendMessage, type Action, type Outcome } from "../core/form.ts"
import { checkValues, compile } from "../core/validate.ts"
import { languageOf, messages } from "../core/messages.ts"
import { PendingForms } from "./pending.ts"
import { formSpecJsonSchema } from "./schema.ts"
import { ChatPoster } from "./ports.ts"

export const resourceUri = "ui://copilot-forms/form.html"
export const resourceMimeType = "text/html;profile=mcp-app"

export class FormHtml extends Context.Service<FormHtml, string>()("copilot-forms/FormHtml") {}

class FormRejected extends Schema.TaggedError<FormRejected, { readonly brand: unique symbol }>()("FormRejected", {
  message: Schema.String
}) {}

const FieldValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)])
const Values = Schema.Record(Schema.String, FieldValue)
const ComputedValues = Schema.Record(Schema.String, Schema.NullOr(Schema.Union([Schema.Finite, Schema.String, Schema.Boolean])))

const OutcomeResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("submitted"),
    values: Values,
    changedByUser: Schema.Array(Schema.String),
    computed: ComputedValues,
    next: Schema.String
  }),
  Schema.Struct({
    status: Schema.Literal("delegated"),
    values: Values,
    computed: ComputedValues,
    next: Schema.String
  }),
  Schema.Struct({ status: Schema.Literal("answer_in_chat"), next: Schema.String })
])

const withNext = (outcome: Outcome): typeof OutcomeResult.Type => ({ ...outcome, next: outcomeText(outcome) })

export const askFormDescription = [
  "Ask the user a question through an interactive form shown in the chat, and wait for the answer.",
  "Use it only when the answer materially changes the work and the question has several interdependent values, many fields, or values whose consequences the user should see (use computed for those).",
  "For a single simple choice, prefer the built-in askQuestions tool instead.",
  "Always prefill every field with your best guess from the workspace and conversation, and explain the source in reason, so the user only fixes what is wrong.",
  "Write labels in the user's language. Never ask for secrets or credentials.",
  "Do not use it when the user asked you to work autonomously.",
  "The result tells you whether the user submitted values, delegated the decision to you, or will answer in chat."
].join(" ")

const AskForm = Tool.dynamic("ask_form", {
  description: askFormDescription,
  parameters: formSpecJsonSchema,
  success: OutcomeResult,
  failure: FormRejected
})
  .annotate(Tool.Title, "Ask with a form")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Meta, { ui: { resourceUri } })

const FormAnswer = Tool.make("form_answer", {
  description: "Deliver the user's answer from the form view. Only the form view calls this tool.",
  parameters: Schema.Struct({
    formKey: Schema.String,
    action: Schema.Literals(["submit", "delegate", "chat"]),
    values: Schema.optionalKey(Schema.Unknown)
  }),
  success: Schema.Struct({ accepted: Schema.Boolean }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormResend = Tool.make("form_resend", {
  description: "Post the changes the user made after answering as a new chat message. Only the form view calls this tool.",
  parameters: Schema.Struct({
    spec: Schema.Unknown,
    before: Schema.Unknown,
    after: Schema.Unknown,
    locale: Schema.optionalKey(Schema.String)
  }),
  success: Schema.Struct({ posted: Schema.Boolean }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormsToolkit = Toolkit.make(AskForm, FormAnswer, FormResend)

const reject = (problems: ReadonlyArray<string>) => Effect.fail(new FormRejected({ message: problems.join("\n") }))

const FormsHandlers = FormsToolkit.toLayer(
  Effect.gen(function* () {
    const pending = yield* PendingForms
    const poster = yield* ChatPoster
    return FormsToolkit.of({
      ask_form: (params) =>
        Effect.gen(function* () {
          const compiled = compile(params)
          if (Result.isFailure(compiled)) {
            return yield* reject(compiled.failure)
          }
          return withNext(yield* pending.wait(compiled.success))
        }),
      form_answer: ({ formKey, action, values }) =>
        Effect.gen(function* () {
          const form = yield* pending.peek(formKey)
          if (form === undefined) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          let checked: typeof Values.Type = {}
          if (action === "submit") {
            const result = checkValues(form.spec, values)
            if (Result.isFailure(result)) {
              return yield* reject(result.failure)
            }
            checked = result.success
          }
          const accepted = yield* pending.resolve(formKey, (latest) => outcomeFor(latest, action as Action, checked))
          if (!accepted) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          return { accepted }
        }),
      form_resend: ({ spec, before, after, locale }) =>
        Effect.gen(function* () {
          const compiled = compile(spec)
          if (Result.isFailure(compiled)) {
            return yield* reject(compiled.failure)
          }
          const form = compiled.success
          const previous = checkValues(form.spec, before)
          const next = checkValues(form.spec, after)
          if (Result.isFailure(previous) || Result.isFailure(next)) {
            return yield* reject([...(Result.isFailure(previous) ? previous.failure : []), ...(Result.isFailure(next) ? next.failure : [])])
          }
          const text = resendMessage(form.spec, previous.success, next.success, messages(languageOf(locale)))
          if (text === undefined) {
            return yield* reject(["no changes: 前回の送信から変更がありません"])
          }
          yield* poster
            .post({ text, title: form.spec.title, values: next.success })
            .pipe(Effect.mapError((error) => new FormRejected({ message: error.message })))
          return { posted: true }
        })
    })
  })
)

const FormResource = McpServer.resource({
  uri: resourceUri,
  name: "Copilot Forms",
  description: "Interactive form view for ask_form",
  mimeType: resourceMimeType,
  content: Effect.gen(function* () {
    const html = yield* FormHtml
    return yield* Schema.decodeEffect(McpSchema.ReadResourceResult)({
      contents: [{ uri: resourceUri, mimeType: resourceMimeType, text: html }]
    }).pipe(Effect.orDie)
  })
})

export const FormsServer = Layer.mergeAll(McpServer.toolkit(FormsToolkit), FormResource).pipe(Layer.provide(FormsHandlers))
