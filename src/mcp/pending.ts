import { Context, Deferred, Effect, Layer, Ref } from "effect"
import type { CompiledForm, Outcome } from "../core/form.ts"
import { WaitingIndicator } from "./ports.ts"

interface Waiter {
  readonly form: CompiledForm
  readonly deferred: Deferred.Deferred<Outcome>
}

type Ledger = ReadonlyMap<string, ReadonlyArray<Waiter>>

const total = (ledger: Ledger): number => [...ledger.values()].reduce((sum, waiters) => sum + waiters.length, 0)

const without = (ledger: Ledger, key: string, waiter: Waiter): Ledger => {
  const rest = (ledger.get(key) ?? []).filter((item) => item !== waiter)
  const next = new Map(ledger)
  if (rest.length === 0) {
    next.delete(key)
  } else {
    next.set(key, rest)
  }
  return next
}

export class PendingForms extends Context.Service<
  PendingForms,
  {
    readonly wait: (form: CompiledForm) => Effect.Effect<Outcome>
    readonly peek: (key: string) => Effect.Effect<CompiledForm | undefined>
    readonly resolve: (key: string, outcome: (form: CompiledForm) => Outcome) => Effect.Effect<boolean>
    readonly size: Effect.Effect<number>
  }
>()("copilot-forms/PendingForms") {}

export const PendingFormsLive = Layer.effect(
  PendingForms,
  Effect.gen(function* () {
    const indicator = yield* WaitingIndicator
    const ledger = yield* Ref.make<Ledger>(new Map())
    const changeLedger = (f: (current: Ledger) => Ledger) =>
      Ref.updateAndGet(ledger, f).pipe(Effect.flatMap((next) => indicator.update(total(next))))

    const wait = (form: CompiledForm) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<Outcome>()
        const waiter: Waiter = { form, deferred }
        yield* changeLedger((current) => new Map(current).set(form.key, [...(current.get(form.key) ?? []), waiter]))
        return yield* Deferred.await(deferred).pipe(Effect.ensuring(changeLedger((current) => without(current, form.key, waiter))))
      })

    const peek = (key: string) => Ref.get(ledger).pipe(Effect.map((current) => current.get(key)?.[0]?.form))

    const resolve = (key: string, outcome: (form: CompiledForm) => Outcome) =>
      Effect.gen(function* () {
        const waiter = yield* Ref.modify(ledger, (current): readonly [Waiter | undefined, Ledger] => {
          const first = current.get(key)?.[0]
          return first === undefined ? [undefined, current] : [first, without(current, key, first)]
        })
        if (waiter === undefined) {
          return false
        }
        yield* Ref.get(ledger).pipe(Effect.flatMap((next) => indicator.update(total(next))))
        return yield* Deferred.succeed(waiter.deferred, outcome(waiter.form))
      })

    return PendingForms.of({ wait, peek, resolve, size: Ref.get(ledger).pipe(Effect.map(total)) })
  })
)
