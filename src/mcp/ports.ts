import { Context, type Effect } from "effect"
import type { Values } from "../core/form.ts"

export interface ChatPost {
  readonly text: string
  readonly title: string
  readonly values: Values
}

export class ChatPoster extends Context.Service<ChatPoster, {
  readonly post: (post: ChatPost) => Effect.Effect<void, ChatPostFailed>
}>()("copilot-forms/ChatPoster") {}

export class ChatPostFailed extends Error {
  readonly _tag = "ChatPostFailed"
}

export class WaitingIndicator extends Context.Service<WaitingIndicator, {
  readonly update: (waiting: number) => Effect.Effect<void>
}>()("copilot-forms/WaitingIndicator") {}
