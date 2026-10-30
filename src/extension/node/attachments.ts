import * as vscode from "vscode"
import { Effect, Layer } from "effect"
import { AttachmentStore, AttachmentStoreFailed } from "../../mcp/ports.ts"
import { writeAttachment } from "../shared/chat.ts"

const stored = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(operation()),
    catch: (error) => new AttachmentStoreFailed({ message: error instanceof Error ? error.message : String(error) })
  })

export const attachmentStore = (storage: vscode.Uri) =>
  Layer.succeed(
    AttachmentStore,
    AttachmentStore.of({
      write: (id, name, text) => stored(() => writeAttachment(storage, id, name, text)).pipe(Effect.asVoid),
      read: (id, name) =>
        stored(() => vscode.workspace.fs.readFile(vscode.Uri.joinPath(storage, "answers", id, name))).pipe(
          Effect.map((bytes) => new TextDecoder().decode(bytes))
        )
    })
  )
