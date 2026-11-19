import assert from "node:assert/strict"
import childProcess, { ChildProcess } from "node:child_process"
import { it, onTestFinished, vi } from "vitest"
import { runCommand } from "../../scripts/process.ts"

const supervised = () => {
  onTestFinished(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  const signals: Array<readonly [number, string | number | undefined]> = []
  const child = Object.assign(new ChildProcess(), {
    pid: 12345,
    kill: (signal?: string) => {
      signals.push([12345, signal])
      return true
    }
  })
  const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => child)
  vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
    signals.push([pid, signal])
    return true
  })
  onTestFinished(() => {
    child.emit("exit", 0)
  })
  return { child, signals, spawn }
}

for (const exitsOnTerm of [false, true]) {
  it(
    `DES-TOOLS-001 直下の子がTERMで${exitsOnTerm ? "終了しても" : "終了しなくても"}プロセス群を猶予後に強制終了する`,
    { skip: process.platform === "win32" },
    async () => {
      const state = supervised()
      const result = runCommand("test", [], 100)
      vi.advanceTimersByTime(100)
      assert.deepEqual(state.signals, [[-12345, "SIGTERM"]])
      assert.equal(state.spawn.mock.calls[0]?.[2]?.detached, true)
      if (exitsOnTerm) {
        state.child.emit("exit", 0)
      }
      vi.advanceTimersByTime(1000)
      assert.deepEqual(state.signals, [
        [-12345, "SIGTERM"],
        [-12345, "SIGKILL"]
      ])
      if (!exitsOnTerm) {
        state.child.emit("exit", null, "SIGKILL")
      }
      assert.equal(await result, 1)
    }
  )
}

it("DES-TOOLS-001 予算内の終了と起動失敗ではタイマーを残さない", async () => {
  const state = supervised()
  const result = runCommand("test", [], 100)
  state.child.emit("exit", 7)
  assert.equal(await result, 7)
  const failed = runCommand("missing", [], 100)
  state.child.emit("error", new Error("ENOENT"))
  await assert.rejects(failed, /ENOENT/)
  vi.advanceTimersByTime(2000)
  assert.deepEqual(state.signals, [])
})

it("DES-TOOLS-001 Windowsでは猶予後の強制終了もプロセスツリーを対象にする", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")
  assert.ok(platform)
  Object.defineProperty(process, "platform", { value: "win32" })
  onTestFinished(() => {
    Object.defineProperty(process, "platform", platform)
  })
  const state = supervised()
  const kill = vi.spyOn(childProcess, "execFile").mockImplementation(() => new ChildProcess())
  const result = runCommand("test", [], 100)
  vi.advanceTimersByTime(100)
  state.child.emit("exit", 0)
  vi.advanceTimersByTime(1000)
  assert.equal(await result, 1)
  assert.deepEqual(
    kill.mock.calls.map((args) => args.slice(0, 2)),
    [
      ["taskkill", ["/PID", "12345", "/T"]],
      ["taskkill", ["/PID", "12345", "/T", "/F"]]
    ]
  )
  assert.equal(state.spawn.mock.calls[0]?.[2]?.detached, false)
  assert.deepEqual(state.signals, [])
})
