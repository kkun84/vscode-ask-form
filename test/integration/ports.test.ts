import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Ref } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { memoryAttachments } from "../support/attachments.ts"
import { withHarness } from "../support/server.ts"

const form = eventForm

describe("ARCH-PORT-001 MCPサーバーへの差し込み口", () => {
  it("ARCH-PORT-001 VS Codeなしで、差し込んだ実装を通して待機を知らせて添付を保存する", () => {
    const { store, files } = memoryAttachments()
    return withHarness(
      (h) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(h.call("ask_form", eventSpec))
          yield* h.waitUntil(1)
          yield* h.call("form_answer", { formKey: form.key, action: "chat" })
          yield* Fiber.join(fiber)
          assert.deepEqual(yield* Ref.get(h.waiting), [1, 0])
          const before = initialValues(form.spec)
          yield* h.call("form_resend", { spec: eventSpec, before, after: { ...before, stream: "no" } })
          assert.equal(files.size, 1)
          assert.deepEqual(JSON.parse([...files.values()][0] ?? "null"), {
            title: eventSpec.title,
            values: { ...before, stream: "no" },
            held: [],
            delegated: []
          })
        }),
      { attachments: store }
    )
  })

  for (const { name, options, waited } of [
    { name: "利用者の不在を知る", options: { unavailable: true }, waited: [] },
    { name: "待っている間に利用者が不在になった事を知る", options: { away: Effect.sleep("20 millis") }, waited: [1, 0] }
  ]) {
    it(`ARCH-PORT-001 VS Codeなしで、差し込んだ実装を通して${name}`, () =>
      withHarness(
        (h) =>
          Effect.gen(function* () {
            const result = yield* h.call("ask_form", eventSpec)
            assert.equal((result.structuredContent as Record<string, unknown>)["status"], "unavailable")
            assert.deepEqual(yield* Ref.get(h.waiting), waited)
          }),
        options
      ))
  }
})
