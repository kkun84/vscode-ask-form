import assert from "node:assert/strict"
import { it } from "node:test"
import { createAppHost } from "../../src/core/appHost.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"

it("DES-HOST-001 初期化前の取り消しを設計図の後に再通知し、回答を受け付けない", async () => {
  const sent: Array<Record<string, unknown>> = []
  const host = createAppHost({
    form: eventForm,
    args: eventSpec,
    context: { theme: "dark", locale: "ja" },
    post: (message) => sent.push(message),
    onOutcome: () => assert.fail("cancelled form accepted an answer"),
    onResend: () => Promise.resolve()
  })
  host.cancel()
  host.cancel()
  assert.equal(sent.length, 1)
  assert.equal(host.settled(), true)
  for (const id of [1, 2]) {
    sent.length = 0
    await host.receive({ id, method: "ui/initialize" })
    assert.deepEqual(
      sent.map((message) => message["method"]),
      [undefined, "ui/notifications/tool-input", "ui/notifications/tool-cancelled"]
    )
  }
  await host.receive({
    id: 3,
    method: "tools/call",
    params: { name: "form_answer", arguments: { formKey: eventForm.key, action: "chat" } }
  })
  const response = sent.at(-1)
  assert.ok(response)
  assert.equal((response["result"] as { readonly isError: boolean }).isError, true)
})
