import { randomUUID } from "node:crypto"
import * as vscode from "vscode"
import { Effect, Exit, Layer, Scope } from "effect"
import { serveForms } from "../../mcp/http.ts"
import { ChatPostFailed, ChatPoster, WaitingIndicator } from "../../mcp/ports.ts"
import { FormHtml } from "../../mcp/server.ts"
import { formHtml, version } from "../shared/assets.ts"
import { postToChat } from "../shared/chat.ts"
import { waitingLabel } from "../shared/labels.ts"
import { createWaitingStatus } from "../shared/waiting.ts"

const providerId = "copilot-forms.mcp"

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
  const waiting = createWaitingStatus(waitingLabel())
  context.subscriptions.push(waiting)
  const services = Layer.mergeAll(
    Layer.succeed(
      ChatPoster,
      ChatPoster.of({
        post: (post) =>
          Effect.tryPromise({
            try: () => postToChat(context.globalStorageUri, post),
            catch: (error) => new ChatPostFailed(error instanceof Error ? error.message : String(error))
          })
      })
    ),
    Layer.succeed(WaitingIndicator, WaitingIndicator.of({ update: (count) => Effect.sync(() => waiting.update(count)) })),
    Layer.succeed(FormHtml, formHtml)
  )
  const token = randomUUID()
  const scope = await Effect.runPromise(Scope.make())
  context.subscriptions.push({ dispose: () => void Effect.runPromise(Scope.close(scope, Exit.void)) })
  const server = await Effect.runPromise(Scope.provide(serveForms({ token, version, services }), scope))
  const changed = new vscode.EventEmitter<void>()
  context.subscriptions.push(
    changed,
    vscode.lm.registerMcpServerDefinitionProvider(providerId, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => [
        new vscode.McpHttpServerDefinition("Copilot Forms", vscode.Uri.parse(server.url), { authorization: `Bearer ${token}` }, version)
      ]
    })
  )
}

export const deactivate = (): void => undefined
