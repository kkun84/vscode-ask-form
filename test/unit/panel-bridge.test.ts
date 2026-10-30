import assert from "node:assert/strict"
import { it } from "node:test"
import { installPanelBridge } from "../../src/extension/web/bridge.ts"
import { connect } from "../../src/ui/bridge.ts"
import { useWindow } from "../support/window.ts"

it("DES-UI-002 パネルは同じoriginの実際の親だけを橋渡しして初期化と中断を受け取る", async (context) => {
  const listeners = new Set<EventListener>()
  const sent: Array<Record<string, unknown>> = []
  const receiver = {
    location: { origin: "https://panel.test" },
    acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) => sent.push(message) }),
    addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener)
  }
  useWindow(context, receiver)
  const install = new Function(`(${installPanelBridge.toString()})()`)
  install()
  const parent = { 0: receiver, length: 1 }
  const events: Array<string> = []
  const connected = connect({
    onToolInput: () => events.push("input"),
    onToolResult: () => events.push("result"),
    onToolCancelled: () => events.push("cancelled"),
    onHostContext: () => events.push("context")
  })
  const deliver = (source: unknown, origin: string, message: Record<string, unknown>) => {
    for (const listener of listeners) {
      listener({ source, origin, data: { jsonrpc: "2.0", ...message } } as MessageEvent)
    }
  }
  for (const source of [null, receiver, { length: 0 }]) {
    deliver(source, receiver.location.origin, { id: 1, result: {} })
  }
  deliver(parent, "https://other.test", { id: 1, result: {} })
  await Promise.resolve()
  assert.equal(sent.length, 1)
  deliver(parent, receiver.location.origin, { id: 1, result: { hostContext: {} } })
  const bridge = await connected
  bridge.notifySize(100)
  deliver(parent, receiver.location.origin, { method: "ui/notifications/tool-cancelled" })
  assert.deepEqual(events, ["context", "cancelled"])
  assert.equal(sent.at(-1)?.["method"], "ui/notifications/size-changed")
  const listener = () => assert.fail(events.join())
  window.addEventListener("message", listener)
  window.removeEventListener("message", listener)
  assert.equal(listeners.size, 1)
})
