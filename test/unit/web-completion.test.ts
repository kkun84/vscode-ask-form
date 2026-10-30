import assert from "node:assert/strict"
import { it } from "node:test"
import { setImmediate } from "node:timers/promises"
import { completeWebRun } from "../acceptance/web-completion.ts"

const browserRun = () => {
  const controls = {
    exit: (_code: number): void => {},
    answer: (): void => {},
    fail: (_error: Error): void => {}
  }
  const answer = new Promise<void>((resolve, reject) => {
    controls.answer = resolve
    controls.fail = reject
  })
  const run = completeWebRun(
    {
      exposeFunction: (name, callback) => {
        assert.equal(name, "codeAutomationExit")
        controls.exit = callback as typeof controls.exit
        return Promise.resolve({ dispose: () => Promise.resolve(), [Symbol.asyncDispose]: () => Promise.resolve() })
      }
    },
    () => answer
  )
  return { ...controls, run }
}

for (const first of ["exit", "answer"] as const) {
  it(`DES-TOOLS-002 ${first}が先に成功しても両方の完了まで待つ`, async () => {
    const run = browserRun()
    let complete = false
    const done = run.run.then(() => (complete = true))
    if (first === "exit") {
      run.exit(0)
    } else {
      run.answer()
    }
    await setImmediate()
    assert.equal(complete, false)
    run.exit(0)
    run.answer()
    await done
    assert.equal(complete, true)
  })
}

for (const side of ["exit", "answer"] as const) {
  it(`DES-TOOLS-002 ${side}が失敗したら他方が完了しなくても失敗する`, async () => {
    const run = browserRun()
    const failed = assert.rejects(run.run, side === "exit" ? /exit code 1/ : /answer failed/)
    if (side === "exit") {
      run.exit(1)
    } else {
      run.fail(new Error("answer failed"))
    }
    await failed
  })
}

it("DES-TOOLS-002 拡張機能が正常終了しても後から失敗するブラウザ側の回答を見逃さない", async () => {
  const run = browserRun()
  run.exit(0)
  const failed = assert.rejects(run.run, /late answer failure/)
  await setImmediate()
  run.fail(new Error("late answer failure"))
  await failed
})
