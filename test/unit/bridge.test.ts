import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { connect } from "../../src/ui/bridge.ts"
import { useWindow } from "../support/window.ts"

const setup = (context: TestContext, crossOrigin = false) => {
  const sent: Array<Record<string, unknown>> = []
  const events: Array<unknown> = []
  let receive: ((event: MessageEvent) => void) | undefined
  const target = {
    get location() {
      if (crossOrigin) {
        throw new Error("cross origin")
      }
      return { origin: "https://host.test" }
    },
    postMessage: (message: Record<string, unknown>) => sent.push(message)
  } as unknown as Window
  const receiver = {
    parent: target,
    addEventListener: (_name: string, listener: typeof receive) => {
      receive = listener
    }
  }
  useWindow(context, receiver)
  const connecting = connect({
    onToolInput: (args) => events.push(args),
    onToolResult: (result) => events.push(result),
    onToolCancelled: () => events.push("cancelled"),
    onHostContext: (value) => events.push(value)
  })
  const deliver = (data: Record<string, unknown>, source: unknown = target, origin = "https://host.test") => {
    assert.ok(receive)
    receive({ data: { jsonrpc: "2.0", ...data }, source, origin } as MessageEvent)
  }
  return { connecting, deliver, events, sent, target, receiver }
}

it("DES-UI-002 別の送り主や異なるoriginからの初期化と通知を無視する", async (context) => {
  const state = setup(context)
  for (const source of [null, {}, state.receiver]) {
    state.deliver({ id: 1, result: { hostContext: { locale: "forged" } } }, source)
    for (const method of ["tool-cancelled", "tool-result", "tool-input", "host-context-changed"]) {
      state.deliver({ method: `ui/notifications/${method}` }, source)
    }
  }
  state.deliver({ id: 1, result: { hostContext: { locale: "forged" } } }, state.target, "https://other.test")
  await Promise.resolve()
  assert.deepEqual(state.events, [])
  assert.equal(state.sent.length, 1)
  state.deliver({ id: 1, result: { hostContext: { locale: "ja" } } })
  await state.connecting
  state.deliver({ method: "ui/notifications/tool-cancelled" })
  assert.deepEqual(state.events, [{ locale: "ja" }, "cancelled"])
})

it("DES-UI-002 呼び出しの成功も失敗も検証したホストからだけ受け付ける", async (context) => {
  const state = setup(context, true)
  state.deliver({ id: 1, result: {} })
  const bridge = await state.connecting
  const result = bridge.callTool("form_answer", {})
  let settled = false
  void result.then(() => (settled = true))
  state.deliver({ id: 2, result: { forged: true } }, {})
  state.deliver({ id: 2, error: { message: "forged" } }, state.target, "https://other.test")
  await Promise.resolve()
  assert.equal(settled, false)
  state.deliver({ id: 2, result: { structuredContent: { accepted: true } } })
  assert.deepEqual(await result, { structuredContent: { accepted: true } })
  const rejected = bridge.callTool("unknown", {})
  state.deliver({ id: 3, error: { message: "unknown tool" } })
  await assert.rejects(rejected, /unknown tool/)
})
