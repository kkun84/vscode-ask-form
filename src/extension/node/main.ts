import { randomUUID } from "node:crypto"
import * as vscode from "vscode"
import { Effect, Exit, Scope } from "effect"
import { serveForms } from "../../mcp/http.ts"
import { version } from "../shared/assets.ts"
import { registerFormTool } from "../shared/formTool.ts"
import { createWaitingStatus } from "../shared/waiting.ts"
import { formServices } from "./services.ts"

const providerId = "ask-form.mcp"

const mcpEnabled = (): boolean =>
  vscode.workspace.getConfiguration("askForm.mcp").get<boolean>("enabled", true) &&
  vscode.workspace.getConfiguration("chat.mcp").get<string>("access", "all") === "all"

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const waiting = createWaitingStatus()
  context.subscriptions.push(waiting)
  const services = formServices(waiting)
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
