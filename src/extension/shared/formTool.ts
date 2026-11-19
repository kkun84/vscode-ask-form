import * as vscode from "vscode"
import { Result } from "effect"
import { createAppHost } from "../../core/appHost.ts"
import { outcomeText, type CompiledForm, type Outcome } from "../../core/form.ts"
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

const askInPanel = (
  waiting: Waiting,
  form: CompiledForm,
  args: Readonly<Record<string, unknown>>,
  token: vscode.CancellationToken
): Promise<Outcome> => {
  if (autoReplies()) {
    return Promise.resolve({ status: "unavailable" })
  }
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
          void Promise.resolve(vscode.commands.executeCommand("workbench.action.chat.open")).catch(() => null)
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
      token.onCancellationRequested(() => panel.dispose()),
      onAutoReply(() => {
        finish({ status: "unavailable" })
        panel.dispose()
      })
    ]
  })
}

export interface FormPanels extends vscode.Disposable {
  readonly ask: (form: CompiledForm, args: Readonly<Record<string, unknown>>, token: vscode.CancellationToken) => Promise<Outcome>
}

export const createFormPanels = (): FormPanels => {
  const panels = new Set<vscode.WebviewPanel>()
  const waiting: Waiting = { panels, status: createWaitingStatus(() => [...panels][0]?.reveal()) }
  return {
    ask: (form, args, token) => askInPanel(waiting, form, args, token),
    dispose: () => waiting.status.dispose()
  }
}

export const registerFormTool = (panels: FormPanels): vscode.Disposable =>
  vscode.lm.registerTool<FormSpec>(toolName, {
    prepareInvocation: (options) => ({ invocationMessage: options.input.title }),
    invoke: async (options, token) => {
      const args = options.input as Readonly<Record<string, unknown>>
      const compiled = compile(args)
      if (Result.isFailure(compiled)) {
        throw new Error(compiled.failure.join("\n"))
      }
      const outcome = await panels.ask(compiled.success, args, token)
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(outcomeText(outcome))])
    }
  })
