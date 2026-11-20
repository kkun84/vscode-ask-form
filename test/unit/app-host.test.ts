import assert from "node:assert/strict"
import { it } from "vitest"
import { createAppHost } from "../../src/core/appHost.ts"
import { eventForm, eventSpec } from "../fixtures/event.ts"

it("DES-HOST-001 中断した後も初期化には設計図を送り、回答は期限切れとして拒否する", () => {
  const sent: Array<Record<string, unknown>> = []
  const host = createAppHost({
    form: eventForm,
    args: eventSpec,
    context: { theme: "dark", locale: "ja" },
    post: (message) => sent.push(message),
    onOutcome: () => assert.fail("cancelled form accepted an answer")
  })
  host.cancel()
  host.cancel()
  assert.deepEqual(sent, [])
  host.receive({ id: 1, method: "ui/initialize" })
  assert.deepEqual(
    sent.map((message) => message["method"]),
    [undefined, "ui/notifications/tool-input"]
  )
  host.receive({
    id: 2,
    method: "tools/call",
    params: { name: "form_answer", arguments: { formKey: eventForm.key, action: "chat" } }
  })
  const response = sent.at(-1)
  assert.ok(response)
  const result = response["result"] as { readonly isError: boolean; readonly content: ReadonlyArray<{ readonly text: string }> }
  assert.equal(result.isError, true)
  assert.match(result.content[0]?.text ?? "", /^expired/)
})

it("DES-HOST-001 回答を受け付けたら結果を一度だけ渡し、画面へは受け付けたことだけを返す", () => {
  const sent: Array<Record<string, unknown>> = []
  const outcomes: Array<unknown> = []
  const host = createAppHost({
    form: eventForm,
    args: eventSpec,
    context: { theme: "dark", locale: "ja" },
    post: (message) => sent.push(message),
    onOutcome: (outcome) => outcomes.push(outcome)
  })
  const answer = (id: number) =>
    host.receive({ id, method: "tools/call", params: { name: "form_answer", arguments: { formKey: eventForm.key, action: "chat" } } })
  answer(1)
  host.cancel()
  answer(2)
  assert.deepEqual(outcomes, [{ status: "answer_in_chat" }])
  assert.deepEqual(
    sent.map((message) => [message["id"], message["method"], (message["result"] as { readonly isError?: boolean }).isError]),
    [
      [1, undefined, false],
      [2, undefined, true]
    ]
  )
  host.receive({ id: 3, method: "tools/call", params: { name: "form_status", arguments: { formKey: eventForm.key } } })
  assert.deepEqual(sent.at(-1)?.["error"], { code: -32601, message: "unknown tool" })
})
