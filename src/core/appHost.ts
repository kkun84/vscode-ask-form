import { Result } from "effect"
import { outcomeFor, outcomeText, type Action, type CompiledForm, type Outcome } from "./form.ts"
import { checkAnswer, type Answer } from "./validate.ts"

export interface HostContext {
  readonly theme: "light" | "dark"
  readonly locale: string
  readonly styles?: { readonly variables: Readonly<Record<string, string>> }
}

export interface AppHostOptions {
  readonly form: CompiledForm
  readonly args: Readonly<Record<string, unknown>>
  readonly context: HostContext
  readonly post: (message: Record<string, unknown>) => void
  readonly onOutcome: (outcome: Outcome) => void
  readonly commentPresets?: ReadonlyArray<string> | undefined
}

export interface AppHost {
  readonly receive: (message: unknown) => void
  readonly cancel: () => void
  readonly settled: () => boolean
}

interface Incoming {
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
}

type ToolResult = ReturnType<typeof textResult>

const textResult = (text: string, isError: boolean, structuredContent?: Readonly<Record<string, unknown>>) => ({
  content: [{ type: "text", text }],
  isError,
  ...(structuredContent === undefined ? {} : { structuredContent })
})

const isAction = (value: unknown): value is Action => value === "submit" || value === "chat"

interface HostState {
  status: "pending" | "answered" | "cancelled"
}

const answerWith = (options: AppHostOptions, state: HostState, params: Record<string, unknown>): ToolResult => {
  if (state.status !== "pending" || params["formKey"] !== options.form.key || !isAction(params["action"])) {
    return textResult("expired: このフォームはもう回答を受け付けていません", true)
  }
  const action = params["action"]
  let answer: Answer = { values: {}, comments: {}, note: undefined }
  if (action === "submit") {
    const checked = checkAnswer(options.form.spec, params)
    if (Result.isFailure(checked)) {
      return textResult(checked.failure.join("\n"), true)
    }
    answer = checked.success
  }
  const outcome = outcomeFor(options.form, action, answer)
  state.status = "answered"
  const structured = { ...outcome, next: outcomeText(outcome) }
  options.onOutcome(outcome)
  options.post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: textResult(structured.next, false, structured) })
  return textResult(JSON.stringify({ accepted: true }), false, { accepted: true })
}

export const createAppHost = (options: AppHostOptions): AppHost => {
  const state: HostState = { status: "pending" }
  const notify = (method: string, params: unknown) => options.post({ jsonrpc: "2.0", method, params })
  const respond = (id: number | string, result: unknown) => options.post({ jsonrpc: "2.0", id, result })

  const initialize = (id: number | string) => {
    respond(id, {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "ask-form-panel", version: "1" },
      hostCapabilities: { serverTools: {} },
      hostContext: { ...options.context, displayMode: "inline" }
    })
    notify("ui/notifications/tool-input", { arguments: options.args })
    if (state.status === "cancelled") {
      notify("ui/notifications/tool-cancelled", { reason: "cancelled" })
    }
  }

  const callTool = (id: number | string, params: Record<string, unknown>) => {
    const args = (params["arguments"] ?? {}) as Record<string, unknown>
    switch (params["name"]) {
      case "form_answer":
        return respond(id, answerWith(options, state, args))
      case "form_settings": {
        const settings = { commentPresets: options.commentPresets ?? null }
        return respond(id, textResult(JSON.stringify(settings), false, settings))
      }
      case "form_status": {
        const status = { status: args["formKey"] === options.form.key ? state.status : "unknown" }
        return respond(id, textResult(JSON.stringify(status), false, status))
      }
      default:
        return options.post({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown tool" } })
    }
  }

  const receive = (raw: unknown) => {
    if (raw === null || typeof raw !== "object") {
      return
    }
    const { id, method, params = {} } = raw as Incoming
    if (id === undefined || method === undefined) {
      return
    }
    if (method === "ui/initialize") {
      initialize(id)
    } else if (method === "tools/call") {
      callTool(id, params)
    } else {
      respond(id, {})
    }
  }

  return {
    receive,
    cancel: () => {
      if (state.status === "pending") {
        state.status = "cancelled"
        notify("ui/notifications/tool-cancelled", { reason: "cancelled" })
      }
    },
    settled: () => state.status !== "pending"
  }
}
