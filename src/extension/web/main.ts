import * as vscode from "vscode"
import { Result } from "effect"
import { createAppHost } from "../../core/appHost.ts"
import { outcomeText, type Outcome } from "../../core/form.ts"
import { compile } from "../../core/validate.ts"
import type { FormSpec } from "../../core/spec.ts"
import { formHtml } from "../shared/assets.ts"
import { postToChat } from "../shared/chat.ts"
import { waitingLabel } from "../shared/labels.ts"
import { createWaitingStatus, type WaitingStatus } from "../shared/waiting.ts"

export const toolName = "forms_ask_form"

const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';"

const rehoist =
  "<script>(()=>{const api=acquireVsCodeApi();const target={postMessage:(m)=>api.postMessage(m)};Object.defineProperty(window,'parent',{get:()=>target});})()</script>"

const panelHtml = (): string => formHtml.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">${rehoist}`)

const themeOf = (kind: vscode.ColorThemeKind): "light" | "dark" =>
  kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark"

const askInPanel = (
  context: vscode.ExtensionContext,
  waiting: WaitingStatus,
  counter: { value: number },
  args: Readonly<Record<string, unknown>>,
  token: vscode.CancellationToken
): Promise<Outcome> => {
  const compiled = compile(args)
  if (Result.isFailure(compiled)) {
    return Promise.reject(new Error(compiled.failure.join("\n")))
  }
  const form = compiled.success
  const panel = vscode.window.createWebviewPanel(
    "ask-form.form",
    form.spec.title,
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false
    },
    { enableScripts: true, retainContextWhenHidden: true }
  )
  panel.webview.html = panelHtml()
  counter.value++
  waiting.update(counter.value)
  return new Promise<Outcome>((resolve) => {
    let finished = false
    const finish = (outcome: Outcome) => {
      if (finished) {
        return
      }
      finished = true
      counter.value--
      waiting.update(counter.value)
      resolve(outcome)
    }
    const host = createAppHost({
      form,
      args,
      context: { theme: themeOf(vscode.window.activeColorTheme.kind), locale: vscode.env.language },
      post: (message) => void panel.webview.postMessage(message),
      onOutcome: finish,
      onResend: (request) => postToChat(context.globalStorageUri, request)
    })
    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => void host.receive(message)),
      panel.onDidDispose(() => {
        host.cancel()
        finish({ status: "answer_in_chat" })
        for (const subscription of subscriptions) {
          subscription.dispose()
        }
      }),
      token.onCancellationRequested(() => {
        host.cancel()
        finish({ status: "answer_in_chat" })
      })
    ]
  })
}

export const activate = (context: vscode.ExtensionContext): void => {
  const waiting = createWaitingStatus(waitingLabel())
  const counter = { value: 0 }
  context.subscriptions.push(
    waiting,
    vscode.lm.registerTool<FormSpec>(toolName, {
      prepareInvocation: (options) => ({ invocationMessage: options.input.title }),
      invoke: async (options, token) => {
        const outcome = await askInPanel(context, waiting, counter, options.input as Readonly<Record<string, unknown>>, token)
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(outcomeText(outcome))])
      }
    })
  )
}

export const deactivate = (): void => undefined
