import { Result } from "effect"
import { outcomeFor, outcomeText, resendMessage, type Action, type CompiledForm, type Outcome, type Values } from "./form.ts"
import { checkValues, compile } from "./validate.ts"
import { languageOf, messages } from "./messages.ts"

export interface HostContext {
  readonly theme: "light" | "dark"
  readonly locale: string
  readonly styles?: { readonly variables: Readonly<Record<string, string>> }
}

export interface ResendRequest {
  readonly text: string
  readonly title: string
  readonly values: Values
}

export interface AppHostOptions {
  readonly form: CompiledForm
  readonly args: Readonly<Record<string, unknown>>
  readonly context: HostContext
  readonly post: (message: Record<string, unknown>) => void
  readonly onOutcome: (outcome: Outcome) => void
  readonly onResend: (request: ResendRequest) => Promise<void>
}

export interface AppHost {
  readonly receive: (message: unknown) => Promise<void>
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

const isAction = (value: unknown): value is Action => value === "submit" || value === "delegate" || value === "chat"

interface HostState {
  status: "pending" | "answered" | "cancelled"
}

const answerWith = (options: AppHostOptions, state: HostState, params: Record<string, unknown>): ToolResult => {
  if (state.status !== "pending" || params["formKey"] !== options.form.key || !isAction(params["action"])) {
    return textResult("expired: このフォームはもう回答を受け付けていません", true)
  }
  const action = params["action"]
  let values: Values = {}
  if (action === "submit") {
    const checked = checkValues(options.form.spec, params["values"])
    if (Result.isFailure(checked)) {
      return textResult(checked.failure.join("\n"), true)
    }
    values = checked.success
  }
  const outcome = outcomeFor(options.form, action, values)
  state.status = "answered"
  const structured = { ...outcome, next: outcomeText(outcome) }
  options.onOutcome(outcome)
  options.post({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: textResult(structured.next, false, structured) })
  return textResult(JSON.stringify({ accepted: true }), false, { accepted: true })
}

const resendWith = async (options: AppHostOptions, params: Record<string, unknown>): Promise<ToolResult> => {
  const compiled = compile(params["spec"])
  if (Result.isFailure(compiled)) {
    return textResult(compiled.failure.join("\n"), true)
  }
  const before = checkValues(compiled.success.spec, params["before"])
  const after = checkValues(compiled.success.spec, params["after"])
  if (Result.isFailure(before) || Result.isFailure(after)) {
    return textResult("invalid values", true)
  }
  const locale = typeof params["locale"] === "string" ? params["locale"] : options.context.locale
  const text = resendMessage(compiled.success.spec, before.success, after.success, messages(languageOf(locale)))
  if (text === undefined) {
    return textResult("no changes: 回答から変更がありません", true)
  }
  try {
    await options.onResend({ text, title: compiled.success.spec.title, values: after.success })
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true)
  }
  return textResult(JSON.stringify({ posted: true }), false, { posted: true })
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

  const callTool = async (id: number | string, params: Record<string, unknown>) => {
    const args = (params["arguments"] ?? {}) as Record<string, unknown>
    switch (params["name"]) {
      case "form_answer":
        return respond(id, answerWith(options, state, args))
      case "form_resend":
        return respond(id, await resendWith(options, args))
      case "form_status": {
        const status = { status: args["formKey"] === options.form.key ? state.status : "unknown" }
        return respond(id, textResult(JSON.stringify(status), false, status))
      }
      default:
        return options.post({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown tool" } })
    }
  }

  const receive = async (raw: unknown) => {
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
      await callTool(id, params)
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
