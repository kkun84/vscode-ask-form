import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Fiber, Ref } from "effect"
import { initialValues } from "../../src/core/form.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"
import { withHarness } from "../support/server.ts"

const form = eventForm

describe("ARCH-PORT-001 MCPサーバーへの差し込み口", () => {
  it("ARCH-PORT-001 VS Codeなしで、差し込んだ実装を通して待機を知らせて投稿する", () =>
    withHarness((h) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(h.call("ask_form", eventSpec))
        yield* h.waitUntil(1)
        yield* h.call("form_answer", { formKey: form.key, action: "delegate" })
        yield* Fiber.join(fiber)
        assert.deepEqual(yield* Ref.get(h.waiting), [1, 0])
        const before = initialValues(form.spec)
        yield* h.call("form_resend", { spec: eventSpec, before, after: { ...before, stream: false } })
        yield* h.call("form_send", {})
        assert.equal(yield* Ref.get(h.submits), 1)
      })
    ))
})
