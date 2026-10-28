import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Layer, Ref } from "effect"
import { PendingForms, PendingFormsLive } from "../../src/mcp/pending.ts"
import { WaitingIndicator } from "../../src/mcp/ports.ts"
import { eventForm } from "../fixtures/event.ts"

const run = <A>(body: (counts: Ref.Ref<ReadonlyArray<number>>) => Effect.Effect<A, never, PendingForms>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const counts = yield* Ref.make<ReadonlyArray<number>>([])
      const indicator = Layer.succeed(
        WaitingIndicator,
        WaitingIndicator.of({ update: (count) => Ref.update(counts, (all) => [...all, count]) })
      )
      return yield* body(counts).pipe(Effect.provide(PendingFormsLive.pipe(Layer.provide(indicator))))
    })
  )

const settle = Effect.yieldNow

describe("DES-PEND-001 待機の台帳", () => {
  it("DES-PEND-001 同じ鍵の待機は先に始まったものから順に結果を受け取る", () =>
    run(() =>
      Effect.gen(function* () {
        const pending = yield* PendingForms
        const first = yield* Effect.forkChild(pending.wait(eventForm))
        yield* settle
        const second = yield* Effect.forkChild(pending.wait(eventForm))
        yield* settle
        assert.equal(yield* pending.size, 2)
        assert.equal(yield* pending.resolve(eventForm.key, () => ({ status: "answer_in_chat" })), true)
        assert.equal(
          yield* pending.resolve(eventForm.key, (form) => ({ status: "delegated", values: {}, computed: { key: form.key } })),
          true
        )
        assert.deepEqual(yield* Fiber.join(first), { status: "answer_in_chat" })
        assert.equal((yield* Fiber.join(second)).status, "delegated")
        assert.equal(yield* pending.resolve(eventForm.key, () => ({ status: "answer_in_chat" })), false)
      })
    ))

  it("DES-PEND-001 取り消された待機は台帳から外し、総数が変わったときだけ知らせる", () =>
    run((counts) =>
      Effect.gen(function* () {
        const pending = yield* PendingForms
        const fiber = yield* Effect.forkChild(pending.wait(eventForm))
        yield* settle
        assert.equal((yield* pending.peek(eventForm.key))?.key, eventForm.key)
        yield* Fiber.interrupt(fiber)
        assert.equal(yield* pending.peek(eventForm.key), undefined)
        assert.deepEqual(yield* Ref.get(counts), [1, 0])
      })
    ))
})
