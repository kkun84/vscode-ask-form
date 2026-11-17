import * as vscode from "vscode"
import { Effect, Layer } from "effect"
import { AttachmentStore, AttachmentStoreFailed } from "../../mcp/ports.ts"

const stored = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (error) => new AttachmentStoreFailed({ message: error instanceof Error ? error.message : String(error) })
  })

const writeAttachment = async (storage: vscode.Uri, id: string, name: string, body: string): Promise<void> => {
  const directory = vscode.Uri.joinPath(storage, "answers", id)
  await vscode.workspace.fs.createDirectory(directory)
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, name), new TextEncoder().encode(body))
}

export const attachmentStore = (storage: vscode.Uri) =>
  Layer.succeed(
    AttachmentStore,
    AttachmentStore.of({
      write: (id, name, text) => stored(() => writeAttachment(storage, id, name, text)),
      read: (id, name) =>
        stored(() => vscode.workspace.fs.readFile(vscode.Uri.joinPath(storage, "answers", id, name))).pipe(
          Effect.map((bytes) => new TextDecoder().decode(bytes))
        )
    })
  )
