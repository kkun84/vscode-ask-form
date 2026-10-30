import { Effect } from "effect"
import { AttachmentStore, AttachmentStoreFailed } from "../../src/mcp/ports.ts"

export const memoryAttachments = (writeError?: string) => {
  const files = new Map<string, string>()
  const store = AttachmentStore.of({
    write: (id, name, text) =>
      writeError === undefined
        ? Effect.sync(() => {
            files.set(`${id}/${name}`, text)
          })
        : Effect.fail(new AttachmentStoreFailed({ message: writeError })),
    read: (id, name) =>
      Effect.suspend(() => {
        const text = files.get(`${id}/${name}`)
        return text === undefined ? Effect.fail(new AttachmentStoreFailed({ message: "attachment not found" })) : Effect.succeed(text)
      })
  })
  return { files, store }
}
