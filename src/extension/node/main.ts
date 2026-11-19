import { randomUUID } from "node:crypto"
import * as vscode from "vscode"
import { Effect, Exit, Layer, Scope } from "effect"
import { serveForms } from "../../mcp/http.ts"
import { UserPresence, WaitingIndicator } from "../../mcp/ports.ts"
import { FormHtml } from "../../mcp/server.ts"
import { formHtml, version } from "../shared/assets.ts"
import { registerFormTool } from "../shared/formTool.ts"
import { autoReplies, createWaitingStatus, onAutoReply } from "../shared/waiting.ts"

const providerId = "ask-form.mcp"

const away = Effect.callback<void>((resume) => {
  const subscription = onAutoReply(() => {
    subscription.dispose()
    resume(Effect.void)
  })
  return Effect.sync(() => subscription.dispose())
})

const mcpEnabled = (): boolean =>
  vscode.workspace.getConfiguration("askForm.mcp").get<boolean>("enabled", true) &&
  vscode.workspace.getConfiguration("chat.mcp").get<string>("access", "all") === "all"

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const waiting = createWaitingStatus()
  context.subscriptions.push(waiting)
  const services = Layer.mergeAll(
    Layer.succeed(WaitingIndicator, WaitingIndicator.of({ update: (count) => Effect.sync(() => waiting.update(count)) })),
    Layer.succeed(UserPresence, UserPresence.of({ unavailable: Effect.sync(autoReplies), away })),
    Layer.succeed(FormHtml, formHtml)
  )
  const token = randomUUID()
  const scope = await Effect.runPromise(Scope.make())
  context.subscriptions.push({ dispose: () => void Effect.runPromise(Scope.close(scope, Exit.void)) })
  const server = await Effect.runPromise(Scope.provide(serveForms({ token, version, services }), scope))
  const changed = new vscode.EventEmitter<void>()
  context.subscriptions.push(
    changed,
    registerFormTool(),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("askForm.mcp.enabled") || event.affectsConfiguration("chat.mcp.access")) {
        changed.fire()
      }
    }),
    vscode.lm.registerMcpServerDefinitionProvider(providerId, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () =>
        mcpEnabled()
          ? [new vscode.McpHttpServerDefinition("Ask Form", vscode.Uri.parse(server.url), { authorization: `Bearer ${token}` }, version)]
          : []
    })
  )
}

export const deactivate = (): void => undefined
