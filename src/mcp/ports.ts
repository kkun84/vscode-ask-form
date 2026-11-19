import { Context, type Effect } from "effect"

export class UserPresence extends Context.Service<
  UserPresence,
  {
    readonly unavailable: Effect.Effect<boolean>
    readonly away: Effect.Effect<void>
  }
>()("ask-form/UserPresence") {}

export class WaitingIndicator extends Context.Service<
  WaitingIndicator,
  {
    readonly update: (waiting: number) => Effect.Effect<void>
  }
>()("ask-form/WaitingIndicator") {}
