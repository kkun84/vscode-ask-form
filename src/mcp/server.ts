import { Context, Effect, Layer, Result, Schema } from "effect"
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai"
import { attachmentName, heldFields, outcomeFor, outcomeText, resendMessage, type Action, type Outcome } from "../core/form.ts"
import { checkAnswer, checkAnswered, compile, type Answer } from "../core/validate.ts"
import { languageOf, messages } from "../core/messages.ts"
import { PendingForms } from "./pending.ts"
import { formSpecJsonSchema } from "./schema.ts"
import { AttachmentStore, UserPresence, UserSettings } from "./ports.ts"

export const resourceUri = "ui://ask-form/form.html"
export const resourceMimeType = "text/html;profile=mcp-app"

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
    comments: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    heldForm: Schema.optionalKey(Schema.Struct({ title: Schema.String, fields: Schema.Array(Schema.Unknown) })),
    note: Schema.optionalKey(Schema.String),
    next: Schema.String
  }),
  Schema.Struct({ status: Schema.Literals(["answer_in_chat", "unavailable"]), next: Schema.String })
])

const withNext = (outcome: Outcome): typeof OutcomeResult.Type => ({ ...outcome, next: outcomeText(outcome) })

export const askFormDescription = [
  "Ask the user a question through an interactive form shown in the chat, and wait for the answer.",
  "Use it only when the answer materially changes the work and the question has several interdependent values, many fields, or values whose consequences the user should see (use computed for those).",
  "For a single simple choice, prefer the built-in askQuestions tool instead.",
  "Set default only when the workspace or conversation gives you grounds to recommend a value; otherwise leave it out and the user must choose.",
  "Use reason only together with default: for a choice, why that option fits best here; for other fields, advice that helps the user decide. Without a default, reason is rejected; put the explanation in description.",
  "Give every option a description of what it is or what happens if chosen, and give a field a description when its meaning is not obvious.",
  "For a yes/no question, use a choice with two options.",
  "When some fields only matter for one option of a single-select choice, put them in that option's fields instead of asking separately; the answer then contains only the chosen option's fields.",
  "Write labels in the user's language. Never ask for secrets or credentials.",
  "Do not use it when the user asked you to work autonomously.",
  "The user can leave a question without a value by commenting on it instead; its id comes back in held, the comment says what to do, and heldForm holds those fields for asking again.",
  "The user can comment on each question; comments come back in comments, keyed by field id.",
  "The user can also add a free-form note to the answers, for example an answer that is not among your options; it comes back in note.",
  "The result tells you whether the user submitted values, cancelled the form to answer in chat, or is unavailable so the form was not shown or was withdrawn."
].join(" ")

const AskForm = Tool.dynamic("ask_form", {
  description: askFormDescription,
  parameters: formSpecJsonSchema,
  success: OutcomeResult,
  failure: FormRejected
})
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
    comments: Schema.optionalKey(Schema.Unknown),
    note: Schema.optionalKey(Schema.Unknown)
  }),
  success: Schema.Struct({ accepted: Schema.Boolean }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormResend = Tool.make("form_resend", {
  description: "Prepare the changes the user made after answering for a chat draft. Only the form view calls this tool.",
  parameters: Schema.Struct({
    spec: Schema.Unknown,
    before: Schema.Unknown,
    after: Schema.Unknown,
    beforeComments: Schema.optionalKey(Schema.Unknown),
    afterComments: Schema.optionalKey(Schema.Unknown),
    locale: Schema.optionalKey(Schema.String)
  }),
  success: Schema.Struct({ text: Schema.String, attachment: Schema.Struct({ uri: Schema.String, name: Schema.String }) }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormStatus = Tool.make("form_status", {
  description: "Check whether the form is still waiting or was cancelled. Only the form view calls this tool.",
  parameters: Schema.Struct({ formKey: Schema.String }),
  success: Schema.Struct({ status: Schema.Literals(["pending", "answered", "cancelled", "unknown"]) })
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormSettings = Tool.make("form_settings", {
  description: "Read the user's settings for the form view. Only the form view calls this tool.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({ commentPresets: Schema.NullOr(Schema.Array(Schema.String)) })
})
  .annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })
  .annotate(Tool.Readonly, true)

const FormsToolkit = Toolkit.make(AskForm, FormAnswer, FormResend, FormStatus, FormSettings)

const reject = (problems: ReadonlyArray<string>) => Effect.fail(new FormRejected({ message: problems.join("\n") }))

const FormsHandlers = FormsToolkit.toLayer(
  Effect.gen(function* () {
    const pending = yield* PendingForms
    const attachments = yield* AttachmentStore
    const presence = yield* UserPresence
    const settings = yield* UserSettings
    return FormsToolkit.of({
      form_settings: () => settings.commentPresets.pipe(Effect.map((presets) => ({ commentPresets: presets ?? null }))),
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
          return withNext(yield* Effect.raceFirst(pending.wait(compiled.success), left))
        }),
      form_answer: ({ formKey, action, values, held, comments, note }) =>
        Effect.gen(function* () {
          const form = yield* pending.peek(formKey)
          if (form === undefined) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          let answer: Answer = { values: {}, comments: {}, note: undefined }
          if (action === "submit") {
            const result = checkAnswer(form.spec, { values, held, comments, note })
            if (Result.isFailure(result)) {
              return yield* reject(result.failure)
            }
            answer = result.success
          }
          const accepted = yield* pending.resolve(formKey, (latest) => outcomeFor(latest, action as Action, answer))
          if (!accepted) {
            return yield* reject(["expired: このフォームはもう回答を受け付けていません"])
          }
          return { accepted }
        }),
      form_resend: (params) =>
        Effect.gen(function* () {
          const compiled = compile(params.spec)
          if (Result.isFailure(compiled)) {
            return yield* reject(compiled.failure)
          }
          const form = compiled.success
          const previous = checkAnswered(form.spec, params.before, params.beforeComments)
          const next = checkAnswered(form.spec, params.after, params.afterComments)
          if (Result.isFailure(previous) || Result.isFailure(next)) {
            return yield* reject([...(Result.isFailure(previous) ? previous.failure : []), ...(Result.isFailure(next) ? next.failure : [])])
          }
          const text = resendMessage(form.spec, previous.success, next.success, messages(languageOf(params.locale)))
          if (text === undefined) {
            return yield* reject(["no changes: 回答から変更がありません"])
          }
          const id = crypto.randomUUID()
          const name = attachmentName(form.spec.title)
          const attachment = {
            title: form.spec.title,
            values: next.success.values,
            held: heldFields(form.spec, next.success.values),
            ...(Object.keys(next.success.comments ?? {}).length === 0 ? {} : { comments: next.success.comments })
          }
          yield* attachments
            .write(id, name, JSON.stringify(attachment, undefined, 2))
            .pipe(Effect.mapError((error) => new FormRejected({ message: error.message })))
          return { text, attachment: { uri: `ask-form://answers/${id}/${encodeURIComponent(name)}`, name } }
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

const AttachmentResource = Layer.unwrap(
  Effect.gen(function* () {
    const attachments = yield* AttachmentStore
    return McpServer.resource`ask-form://answers/${Schema.String}/${Schema.String}`({
      name: "Resent answer",
      description: "All values of a resent form answer",
      mimeType: "application/json",
      content: (uri, id) =>
        Effect.gen(function* () {
          const name = decodeURIComponent(new URL(uri).pathname.split("/").at(-1) ?? "")
          if (!/^[0-9a-f-]{36}$/.test(id) || !/^[\p{L}\p{N}-]+\.json$/u.test(name)) {
            return yield* new FormRejected({ message: "invalid attachment path" })
          }
          return yield* attachments.read(id, name)
        })
    })
  })
)

export const FormsServer = Layer.mergeAll(McpServer.toolkit(FormsToolkit), FormResource, AttachmentResource).pipe(
  Layer.provide(FormsHandlers)
)
