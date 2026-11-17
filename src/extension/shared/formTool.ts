import * as vscode from "vscode"
import { Result } from "effect"
import { createAppHost } from "../../core/appHost.ts"
import { outcomeText, type Outcome } from "../../core/form.ts"
import { compile } from "../../core/validate.ts"
import type { FormSpec } from "../../core/spec.ts"
import { autoReplies, createWaitingStatus, onAutoReply, type WaitingStatus } from "./waiting.ts"
import { panelHtml } from "./panel.ts"

const toolName = "forms_ask_form"

const themeOf = (kind: vscode.ColorThemeKind): "light" | "dark" =>
  kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark"

interface Waiting {
  readonly status: WaitingStatus
  readonly panels: Set<vscode.WebviewPanel>
}

const askInPanel = (waiting: Waiting, args: Readonly<Record<string, unknown>>, token: vscode.CancellationToken): Promise<Outcome> => {
  const compiled = compile(args)
  if (Result.isFailure(compiled)) {
    return Promise.reject(new Error(compiled.failure.join("\n")))
  }
  if (autoReplies()) {
    return Promise.resolve({ status: "unavailable" })
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
  waiting.panels.add(panel)
  waiting.status.update(waiting.panels.size)
  return new Promise<Outcome>((resolve) => {
    let open = true
    const finish = (outcome: Outcome) => {
      if (waiting.panels.delete(panel)) {
        waiting.status.update(waiting.panels.size)
        resolve(outcome)
      }
    }
    const host = createAppHost({
      form,
      args,
      context: { theme: themeOf(vscode.window.activeColorTheme.kind), locale: vscode.env.language },
      post: (message) => {
        if (open) {
          void webview.postMessage(message)
        }
      },
      onOutcome: (outcome) => {
        finish(outcome)
        panel.dispose()
        if (outcome.status === "answer_in_chat") {
          void vscode.commands.executeCommand("workbench.action.chat.open")
        }
      }
    })
    const subscriptions = [
      webview.onDidReceiveMessage((message: unknown) => host.receive(message)),
      panel.onDidDispose(() => {
        open = false
        host.cancel()
        finish({ status: "answer_in_chat" })
        for (const subscription of subscriptions) {
          subscription.dispose()
        }
      }),
      token.onCancellationRequested(() => {
        host.cancel()
        finish({ status: "answer_in_chat" })
      }),
      onAutoReply(() => {
        finish({ status: "unavailable" })
        panel.dispose()
      })
    ]
  })
}

export const registerFormTool = (): vscode.Disposable => {
  const panels = new Set<vscode.WebviewPanel>()
  const waiting: Waiting = { panels, status: createWaitingStatus(() => [...panels][0]?.reveal()) }
  const registration = vscode.lm.registerTool<FormSpec>(toolName, {
    prepareInvocation: (options) => ({ invocationMessage: options.input.title }),
    invoke: async (options, token) => {
      const outcome = await askInPanel(waiting, options.input as Readonly<Record<string, unknown>>, token)
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(outcomeText(outcome))])
    }
  })
  return {
    dispose: () => {
      registration.dispose()
      waiting.status.dispose()
    }
  }
}
