import { Result } from "effect"
import { createAppHost, type HostContext, type ResendRequest } from "../../src/core/appHost.ts"
import type { Outcome } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"

interface Setup {
  readonly args: Readonly<Record<string, unknown>>
  readonly context: HostContext
  readonly expireOnAnswer: boolean
  readonly failResend: boolean
  readonly holdResend: boolean
  readonly restore: Readonly<Record<string, unknown>> | undefined
  readonly background: string
}

interface Recorder {
  readonly outcomes: Array<Outcome>
  readonly resends: Array<ResendRequest>
  readonly messages: Array<unknown>
  cancel: () => void
  release: () => void
}

const setup = (window as unknown as { readonly harnessSetup: Setup }).harnessSetup
document.body.style.background = setup.background
const recorder: Recorder = { outcomes: [], resends: [], messages: [], cancel: () => {}, release: () => {} }
;(window as unknown as { harness: Recorder }).harness = recorder

const frame = document.createElement("iframe")
frame.id = "form"
frame.title = "form"
const post = (message: Record<string, unknown>) => frame.contentWindow?.postMessage(message, "*")

const compiled = compile(setup.args)
if (Result.isFailure(compiled)) {
  throw new Error(compiled.failure.join("\n"))
}

const host = createAppHost({
  form: compiled.success,
  args: setup.args,
  context: setup.context,
  post,
  onOutcome: (outcome) => recorder.outcomes.push(outcome),
  onResend: (request) => {
    if (setup.failResend) {
      return Promise.reject(new Error("chat unavailable"))
    }
    recorder.resends.push(request)
    return setup.holdResend
      ? new Promise<void>((resolve) => {
          recorder.release = resolve
        })
      : Promise.resolve()
  }
})
recorder.cancel = () => host.cancel()

window.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
  if (event.source !== frame.contentWindow) {
    return
  }
  const message = event.data
  recorder.messages.push(message)
  const params = (message["params"] ?? {}) as Record<string, unknown>
  if (setup.expireOnAnswer && message["method"] === "tools/call" && params["name"] === "form_answer") {
    post({ jsonrpc: "2.0", id: message["id"], result: { isError: true, content: [{ type: "text", text: "expired" }] } })
    return
  }
  void relay(message)
})

const relay = async (message: Record<string, unknown>) => {
  await host.receive(message)
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
