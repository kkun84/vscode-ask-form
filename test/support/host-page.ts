import { Result } from "effect"
import { createAppHost, type HostContext } from "../../src/core/appHost.ts"
import { heldFields, resendMessage, type Outcome, type Values } from "../../src/core/form.ts"
import { languageOf, messages } from "../../src/core/messages.ts"
import { checkAnswered, compile } from "../../src/core/validate.ts"

interface ResendRequest {
  readonly text: string
  readonly values: Values
  readonly held: ReadonlyArray<string>
  readonly comments: Readonly<Record<string, string>>
}

interface Setup {
  readonly args: Readonly<Record<string, unknown>>
  readonly context: HostContext
  readonly expireOnAnswer: boolean
  readonly unavailableBeforeExpiry: boolean
  readonly failResend: boolean
  readonly holdResend: boolean
  readonly omitCancellation: boolean
  readonly holdStatus: boolean
  readonly placeMessage: "placed" | "refused" | undefined
  readonly restore: Readonly<Record<string, unknown>> | undefined
  readonly background: string
  readonly commentPresets?: ReadonlyArray<string>
}

interface Recorder {
  readonly outcomes: Array<Outcome>
  readonly resends: Array<ResendRequest>
  readonly messages: Array<unknown>
  cancel: () => void
  release: () => void
  releaseStatus: (result: Record<string, unknown>) => void
}

const setup = (window as unknown as { readonly harnessSetup: Setup }).harnessSetup
document.body.style.background = setup.background
const recorder: Recorder = { outcomes: [], resends: [], messages: [], cancel: () => {}, release: () => {}, releaseStatus: () => {} }
;(window as unknown as { harness: Recorder }).harness = recorder

const frame = document.createElement("iframe")
frame.id = "form"
frame.title = "form"
const post = (message: Record<string, unknown>) => {
  if (!(setup.omitCancellation && message["method"] === "ui/notifications/tool-cancelled")) {
    frame.contentWindow?.postMessage(message, "*")
  }
}

const compiled = compile(setup.args)
if (Result.isFailure(compiled)) {
  throw new Error(compiled.failure.join("\n"))
}

const host = createAppHost({
  form: compiled.success,
  args: setup.args,
  context: setup.context,
  commentPresets: setup.commentPresets,
  post,
  onOutcome: (outcome) => recorder.outcomes.push(outcome)
})
recorder.cancel = () => host.cancel()

window.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
  if (event.source !== frame.contentWindow) {
    return
  }
  const message = event.data
  recorder.messages.push(message)
  const params = (message["params"] ?? {}) as Record<string, unknown>
  if (setup.holdStatus && message["method"] === "tools/call" && params["name"] === "form_status") {
    recorder.releaseStatus = (result) => post({ jsonrpc: "2.0", id: message["id"], result })
    return
  }
  if (answerAsServer(message, params)) {
    return
  }
  if (setup.expireOnAnswer && message["method"] === "tools/call" && params["name"] === "form_answer") {
    if (setup.unavailableBeforeExpiry) {
      post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { status: "unavailable" } } })
    }
    post({ jsonrpc: "2.0", id: message["id"], result: { isError: true, content: [{ type: "text", text: "expired" }] } })
    return
  }
  relay(message)
})

const failed = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

const prepareResend = (args: Record<string, unknown>): Record<string, unknown> => {
  const { spec } = compiled.success
  const before = checkAnswered(spec, args["before"], args["beforeComments"])
  const after = checkAnswered(spec, args["after"], args["afterComments"])
  if (setup.failResend || Result.isFailure(before) || Result.isFailure(after)) {
    return failed("chat unavailable")
  }
  const text = resendMessage(spec, before.success, after.success, messages(languageOf(setup.context.locale)))
  if (text === undefined) {
    return failed("no changes")
  }
  recorder.resends.push({
    text,
    values: after.success.values,
    held: heldFields(spec, after.success.values),
    comments: after.success.comments ?? {}
  })
  return {
    isError: false,
    content: [{ type: "text", text: "" }],
    structuredContent: { text, attachment: { uri: "ask-form://answers/1/form.json", name: "form.json" } }
  }
}

const answerAsServer = (message: Record<string, unknown>, params: Record<string, unknown>): boolean => {
  const reply = (result: Record<string, unknown>) => post({ jsonrpc: "2.0", id: message["id"], result })
  if (message["method"] === "ui/message") {
    reply({ isError: setup.placeMessage === "refused" })
    return true
  }
  if (message["method"] === "tools/call" && params["name"] === "form_resend") {
    const result = prepareResend((params["arguments"] ?? {}) as Record<string, unknown>)
    if (setup.holdResend) {
      recorder.release = () => reply(result)
    } else {
      reply(result)
    }
    return true
  }
  return false
}

const relay = (message: Record<string, unknown>) => {
  host.receive(message)
  if (message["method"] === "ui/initialize" && setup.restore !== undefined) {
    post({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { isError: false, content: [{ type: "text", text: "" }], structuredContent: setup.restore }
    })
  }
}

frame.src = "/form.html"
document.body.append(frame)
