import assert from "node:assert/strict"
import { it } from "node:test"
import { runCommand } from "../../scripts/process.ts"

it("SPEC-EXT-005 TERMを無視するテストの子も時間の予算と猶予で終了する", { timeout: 4500 }, async () => {
  const code = await runCommand(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], 500)
  assert.equal(code, 1)
})
