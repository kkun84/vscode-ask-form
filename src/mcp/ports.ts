import { Context, Schema, type Effect } from "effect"

export class ChatPoster extends Context.Service<
  ChatPoster,
  {
    readonly submit: Effect.Effect<void, ChatPostFailed>
  }
>()("ask-form/ChatPoster") {}

export class ChatPostFailed extends Schema.TaggedError<ChatPostFailed, { readonly brand: unique symbol }>()("ChatPostFailed", {
  message: Schema.String
}) {}

export class WaitingIndicator extends Context.Service<
  WaitingIndicator,
  {
    readonly update: (waiting: number) => Effect.Effect<void>
  }
>()("ask-form/WaitingIndicator") {}
