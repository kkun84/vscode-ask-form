import { Context, Schema, type Effect } from "effect"

export class AttachmentStore extends Context.Service<
  AttachmentStore,
  {
    readonly write: (id: string, name: string, text: string) => Effect.Effect<void, AttachmentStoreFailed>
    readonly read: (id: string, name: string) => Effect.Effect<string, AttachmentStoreFailed>
  }
>()("ask-form/AttachmentStore") {}

export class AttachmentStoreFailed extends Schema.TaggedError<AttachmentStoreFailed, { readonly brand: unique symbol }>()(
  "AttachmentStoreFailed",
  {
    message: Schema.String
  }
) {}

export class WaitingIndicator extends Context.Service<
  WaitingIndicator,
  {
    readonly update: (waiting: number) => Effect.Effect<void>
  }
>()("ask-form/WaitingIndicator") {}
