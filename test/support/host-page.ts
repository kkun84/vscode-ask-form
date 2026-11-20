import { Result } from "effect"
import { createAppHost, type HostContext } from "../../src/core/appHost.ts"
import type { Outcome } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"

interface Setup {
  readonly args: Readonly<Record<string, unknown>>
  readonly context: HostContext
  readonly background: string
  readonly commentPresets?: ReadonlyArray<string>
}

interface Recorder {
  readonly outcomes: Array<Outcome>
  readonly messages: Array<unknown>
  cancel: () => void
}

const setup = (window as unknown as { readonly harnessSetup: Setup }).harnessSetup
document.body.style.background = setup.background
const recorder: Recorder = { outcomes: [], messages: [], cancel: () => {} }
;(window as unknown as { harness: Recorder }).harness = recorder

const frame = document.createElement("iframe")
frame.id = "form"
frame.title = "form"

const compiled = compile(setup.args)
if (Result.isFailure(compiled)) {
  throw new Error(compiled.failure.join("\n"))
}

const host = createAppHost({
  form: compiled.success,
  args: setup.args,
  context: setup.context,
  commentPresets: setup.commentPresets,
  post: (message) => frame.contentWindow?.postMessage(message, "*"),
  onOutcome: (outcome) => recorder.outcomes.push(outcome)
})
recorder.cancel = () => host.cancel()

window.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
  if (event.source !== frame.contentWindow) {
    return
  }
  recorder.messages.push(event.data)
  host.receive(event.data)
})

frame.src = "/form.html"
document.body.append(frame)
