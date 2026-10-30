import { Context, Effect, Layer, Ref, Result, Schema } from "effect"
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai"
import {
  attachmentName,
  outcomeFor,
  outcomeText,
  resendMessage,
  type Action,
  type Outcome,
  type Values as FormValues
} from "../core/form.ts"
import { checkValues, compile } from "../core/validate.ts"
import { languageOf, messages } from "../core/messages.ts"
import { PendingForms } from "./pending.ts"
import { formSpecJsonSchema } from "./schema.ts"
import { ChatPoster } from "./ports.ts"

export const resourceUri = "ui://ask-form/form.html"
export const resourceMimeType = "text/html;profile=mcp-app"

export class FormHtml extends Context.Service<FormHtml, string>()("ask-form/FormHtml") {}

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
  .annotate(Tool.OpenWorld, false)
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
  success: Schema.Struct({ text: Schema.String, attachment: Schema.Struct({ uri: Schema.String, name: Schema.String }) }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormSend = Tool.make("form_send", {
  description: "Send the message the form view placed in its own conversation. Only the form view calls this tool.",
  success: Schema.Struct({ sent: Schema.Boolean }),
  failure: FormRejected
}).annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormStatus = Tool.make("form_status", {
  description: "Check whether the form is still waiting or was cancelled. Only the form view calls this tool.",
  parameters: Schema.Struct({ formKey: Schema.String }),
  success: Schema.Struct({ status: Schema.Literals(["pending", "answered", "cancelled", "unknown"]) })
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Meta, { ui: { resourceUri, visibility: ["app"] } })

const FormsToolkit = Toolkit.make(AskForm, FormAnswer, FormResend, FormSend, FormStatus)

interface Attachment {
  readonly title: string
  readonly values: FormValues
}

class Attachments extends Context.Service<
  Attachments,
  {
    readonly put: (attachment: Attachment) => Effect.Effect<{ readonly uri: string; readonly name: string }>
    readonly get: (id: string) => Effect.Effect<Attachment | undefined>
  }
>()("ask-form/Attachments") {}

const AttachmentsLive = Layer.effect(
  Attachments,
  Effect.gen(function* () {
    const stored = yield* Ref.make<ReadonlyMap<string, Attachment>>(new Map())
    return Attachments.of({
      put: (attachment) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          yield* Ref.update(stored, (current) => new Map([...current, [id, attachment] as const].slice(-64)))
          const name = attachmentName(attachment.title)
          return { uri: `ask-form://answers/${id}/${encodeURIComponent(name)}`, name }
        }),
      get: (id) => Ref.get(stored).pipe(Effect.map((current) => current.get(id)))
    })
  })
)

const reject = (problems: ReadonlyArray<string>) => Effect.fail(new FormRejected({ message: problems.join("\n") }))

const FormsHandlers = FormsToolkit.toLayer(
  Effect.gen(function* () {
    const pending = yield* PendingForms
    const poster = yield* ChatPoster
    const attachments = yield* Attachments
    return FormsToolkit.of({
      form_status: ({ formKey }) => pending.status(formKey).pipe(Effect.map((status) => ({ status }))),
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
          const attachment = yield* attachments.put({ title: form.spec.title, values: next.success })
          return { text, attachment }
        }),
      form_send: () =>
        poster.submit.pipe(
          Effect.mapError((error) => new FormRejected({ message: error.message })),
          Effect.as({ sent: true })
        )
    })
  })
)

const FormResource = McpServer.resource({
  uri: resourceUri,
  name: "Ask Form",
  description: "Interactive form view for ask_form",
  mimeType: resourceMimeType,
  content: Effect.gen(function* () {
    const html = yield* FormHtml
    return yield* Schema.decodeEffect(McpSchema.ReadResourceResult)({
      contents: [{ uri: resourceUri, mimeType: resourceMimeType, text: html }]
    }).pipe(Effect.orDie)
  })
})

const AttachmentResource = McpServer.resource`ask-form://answers/${Schema.String}/${Schema.String}`({
  name: "Resent answer",
  description: "All values of a resent form answer",
  mimeType: "application/json",
  content: (_uri, id) =>
    Effect.gen(function* () {
      const attachments = yield* Attachments
      const attachment = yield* attachments.get(id)
      if (attachment === undefined) {
        return yield* new FormRejected({ message: `unknown attachment ${id}` })
      }
      return JSON.stringify(attachment, undefined, 2)
    })
})

export const FormsServer = Layer.mergeAll(McpServer.toolkit(FormsToolkit), FormResource, AttachmentResource).pipe(
  Layer.provide(FormsHandlers),
  Layer.provide(AttachmentsLive)
)
