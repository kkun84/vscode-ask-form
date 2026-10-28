import { Result } from "effect"
import {
  outcomeFor,
  outcomeText,
  resendMessage,
  type Action,
  type CompiledForm,
  type Outcome,
  type Values
} from "./form.ts"
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

const textResult = (text: string, isError: boolean, structuredContent?: Readonly<Record<string, unknown>>) => ({
  content: [{ type: "text", text }],
  isError,
  ...(structuredContent === undefined ? {} : { structuredContent })
})

const isAction = (value: unknown): value is Action => value === "submit" || value === "delegate" || value === "chat"

export const createAppHost = (options: AppHostOptions): AppHost => {
  let done = false
  const notify = (method: string, params: unknown) => options.post({ jsonrpc: "2.0", method, params })
  const respond = (id: number | string, result: unknown) => options.post({ jsonrpc: "2.0", id, result })

  const answer = (params: Record<string, unknown>) => {
    if (done || params["formKey"] !== options.form.key || !isAction(params["action"])) {
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
    done = true
    const structured = { ...outcome, next: outcomeText(outcome) }
    options.onOutcome(outcome)
    notify("ui/notifications/tool-result", textResult(structured.next, false, structured))
    return textResult(JSON.stringify({ accepted: true }), false, { accepted: true })
  }

  const resend = async (params: Record<string, unknown>) => {
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
      return textResult("no changes: 前回の送信から変更がありません", true)
    }
    try {
      await options.onResend({ text, title: compiled.success.spec.title, values: after.success })
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true)
    }
    return textResult(JSON.stringify({ posted: true }), false, { posted: true })
  }

  const receive = async (raw: unknown) => {
    if (raw === null || typeof raw !== "object") {
      return
    }
    const message = raw as Incoming
    const params = message.params ?? {}
    switch (message.method) {
      case "ui/initialize":
        if (message.id !== undefined) {
          respond(message.id, {
            protocolVersion: "2026-01-26",
            hostInfo: { name: "copilot-forms-panel", version: "1" },
            hostCapabilities: { serverTools: {} },
            hostContext: { ...options.context, displayMode: "inline" }
          })
          notify("ui/notifications/tool-input", { arguments: options.args })
        }
        return
      case "tools/call": {
        if (message.id === undefined) {
          return
        }
        const args = (params["arguments"] ?? {}) as Record<string, unknown>
        if (params["name"] === "form_answer") {
          respond(message.id, answer(args))
        } else if (params["name"] === "form_resend") {
          respond(message.id, await resend(args))
        } else {
          options.post({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown tool" } })
        }
        return
      }
      default:
        if (message.id !== undefined && message.method !== undefined) {
          respond(message.id, {})
        }
    }
  }

  return {
    receive,
    cancel: () => {
      if (!done) {
        done = true
        notify("ui/notifications/tool-cancelled", { reason: "cancelled" })
      }
    },
    settled: () => done
  }
}
