import { Context, type Effect } from "effect"
import type { CompiledForm, Outcome } from "../core/form.ts"

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

export class FormPanel extends Context.Service<
  FormPanel,
  {
    readonly ask: (form: CompiledForm, args: Readonly<Record<string, unknown>>) => Effect.Effect<Outcome>
  }
>()("ask-form/FormPanel") {}
