import assert from "node:assert/strict"
import { describe, it, onTestFinished, vi } from "vitest"
import { watchStatus } from "../../src/ui/status.ts"
import type { ToolResult } from "../../src/ui/bridge.ts"

const monitor = () => {
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis })
  const requests: Array<{ readonly resolve: (value: ToolResult) => void; readonly reject: (error: Error) => void }> = []
  let cancelled = 0
  const stop = watchStatus(
    {
      callTool: (name, args) => {
        assert.equal(name, "form_status")
        assert.deepEqual(args, { formKey: "test-form" })
        return new Promise((resolve, reject) => {
          requests.push({ resolve, reject })
        })
      },
      notifySize: () => {}
    },
    "test-form",
    () => cancelled++
  )
  onTestFinished(() => {
    stop()
    Reflect.deleteProperty(globalThis, "window")
  })
  const reply = async (result: ToolResult | Error) => {
    const request = requests.at(-1)
    assert.ok(request)
    if (result instanceof Error) {
      request.reject(result)
    } else {
      request.resolve(result)
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
  return { requests, stop, reply, cancelled: () => cancelled }
}

describe("DES-UI-001 中断状態の確認", () => {
  it("DES-UI-001 未登録や失敗では再確認し、中断を一度知らせると確認を止める", async () => {
    const state = monitor()
    for (const result of [
      { structuredContent: { status: "unknown" } },
      new Error("offline"),
      { isError: true, structuredContent: { status: "cancelled" } },
      { structuredContent: { status: "answered" } },
      { structuredContent: { status: "pending" } }
    ]) {
      await state.reply(result)
      assert.equal(state.cancelled(), 0)
      const count = state.requests.length
      vi.advanceTimersByTime(1000)
      assert.equal(state.requests.length, count + 1)
    }
    await state.reply({ structuredContent: { status: "cancelled" } })
    assert.equal(state.cancelled(), 1)
    vi.advanceTimersByTime(5000)
    assert.equal(state.requests.length, 6)
  })

  it("DES-UI-001 返答を待つ間は重ねて確認せず、終了後の遅い返答を無視する", async () => {
    const state = monitor()
    vi.advanceTimersByTime(5000)
    assert.equal(state.requests.length, 1)
    state.stop()
    await state.reply({ structuredContent: { status: "cancelled" } })
    vi.advanceTimersByTime(5000)
    assert.equal(state.cancelled(), 0)
    assert.equal(state.requests.length, 1)
  })
})
