import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Layer, Ref } from "effect"
import { PendingForms, PendingFormsLive } from "../../src/mcp/pending.ts"
import { WaitingIndicator } from "../../src/mcp/ports.ts"
import { eventForm } from "../fixtures/event.ts"

const run = <A>(body: (pending: PendingForms["Service"], counts: Ref.Ref<ReadonlyArray<number>>) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const counts = yield* Ref.make<ReadonlyArray<number>>([])
      const indicator = Layer.succeed(
        WaitingIndicator,
        WaitingIndicator.of({ update: (count) => Ref.update(counts, (all) => [...all, count]) })
      )
      return yield* PendingForms.pipe(
        Effect.flatMap((pending) => body(pending, counts)),
        Effect.provide(PendingFormsLive.pipe(Layer.provide(indicator)))
      )
    })
  )

const startWaiting = (pending: PendingForms["Service"], form = eventForm) =>
  Effect.forkChild(pending.wait(form)).pipe(Effect.tap(() => Effect.yieldNow))

describe("DES-PEND-001 待機の台帳", () => {
  it("DES-PEND-001 同じ鍵の待機は先に始まったものから順に結果を受け取る", () =>
    run((pending) =>
      Effect.gen(function* () {
        const first = yield* startWaiting(pending)
        const second = yield* startWaiting(pending)
        assert.equal(yield* pending.size, 2)
        assert.equal(yield* pending.resolve(eventForm.key, () => ({ status: "answer_in_chat" })), true)
        assert.equal(
          yield* pending.resolve(eventForm.key, (form) => ({ status: "delegated", values: {}, computed: { key: form.key } })),
          true
        )
        assert.deepEqual(yield* Fiber.join(first), { status: "answer_in_chat" })
        assert.equal((yield* Fiber.join(second)).status, "delegated")
        assert.equal(yield* pending.resolve(eventForm.key, () => ({ status: "answer_in_chat" })), false)
        assert.equal(yield* pending.status(eventForm.key), "answered")
      })
    ))

  it("DES-PEND-001 取り消された待機は台帳から外し、総数が変わったときだけ知らせる", () =>
    run((pending, counts) =>
      Effect.gen(function* () {
        assert.equal(yield* pending.status(eventForm.key), "unknown")
        const fiber = yield* startWaiting(pending)
        assert.equal(yield* pending.status(eventForm.key), "pending")
        assert.equal((yield* pending.peek(eventForm.key))?.key, eventForm.key)
        yield* Fiber.interrupt(fiber)
        assert.equal(yield* pending.peek(eventForm.key), undefined)
        assert.equal(yield* pending.status(eventForm.key), "cancelled")
        assert.deepEqual(yield* Ref.get(counts), [1, 0])
      })
    ))

  it("DES-PEND-001 同じ鍵の待機が残る間や再度質問したときは過去の中断を返さない", () =>
    run((pending) =>
      Effect.gen(function* () {
        const first = yield* startWaiting(pending)
        const second = yield* startWaiting(pending)
        yield* Fiber.interrupt(first)
        assert.equal(yield* pending.status(eventForm.key), "pending")
        yield* Fiber.interrupt(second)
        assert.equal(yield* pending.status(eventForm.key), "cancelled")
        const next = yield* startWaiting(pending)
        assert.equal(yield* pending.status(eventForm.key), "pending")
        yield* pending.resolve(eventForm.key, () => ({ status: "answer_in_chat" }))
        yield* Fiber.join(next)
        assert.equal(yield* pending.status(eventForm.key), "answered")
      })
    ))

  it("DES-PEND-001 終了状態は直近128個の鍵だけを保持する", () =>
    run((pending) =>
      Effect.gen(function* () {
        for (let index = 0; index < 129; index++) {
          const fiber = yield* startWaiting(pending, { ...eventForm, key: String(index) })
          yield* Fiber.interrupt(fiber)
        }
        assert.equal(yield* pending.status("0"), "unknown")
        assert.equal(yield* pending.status("1"), "cancelled")
        assert.equal(yield* pending.status("128"), "cancelled")
        assert.equal(yield* pending.size, 0)
      })
    ))
})
