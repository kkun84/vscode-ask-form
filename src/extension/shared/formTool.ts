import * as vscode from "vscode"
import { Result } from "effect"
import { createAppHost } from "../../core/appHost.ts"
import { outcomeText, type Outcome } from "../../core/form.ts"
import { compile } from "../../core/validate.ts"
import type { FormSpec } from "../../core/spec.ts"
import { postToChat } from "./chat.ts"
import { createWaitingStatus, type WaitingStatus } from "./waiting.ts"
import { panelHtml } from "./panel.ts"

const toolName = "forms_ask_form"

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
  const webview = panel.webview
  webview.html = panelHtml()
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
      post: (message) => void webview.postMessage(message),
      onOutcome: finish,
      onResend: (request) => postToChat(context.globalStorageUri, request)
    })
    const subscriptions = [
      webview.onDidReceiveMessage((message: unknown) => void host.receive(message)),
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

export const registerFormTool = (context: vscode.ExtensionContext): vscode.Disposable => {
  const waiting = createWaitingStatus()
  const counter = { value: 0 }
  const registration = vscode.lm.registerTool<FormSpec>(toolName, {
    prepareInvocation: (options) => ({ invocationMessage: options.input.title }),
    invoke: async (options, token) => {
      const outcome = await askInPanel(context, waiting, counter, options.input as Readonly<Record<string, unknown>>, token)
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(outcomeText(outcome))])
    }
  })
  return {
    dispose: () => {
      registration.dispose()
      waiting.dispose()
    }
  }
}
