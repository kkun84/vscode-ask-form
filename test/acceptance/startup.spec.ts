import { runCommand } from "./commands.ts"
import { test } from "./fixtures.ts"
import { until } from "./frames.ts"
import { openSession } from "./session.ts"

test("REQ-PERF-001 起動完了後に、ツールが呼ばれなくても自動で有効になる", async ({ platform }, testInfo) => {
  const session = await openSession(platform, testInfo.project.outputDir, "startup")
  try {
    await until(
      async () => {
        await runCommand(session.window, "Ask User Form: Report acceptance state")
        return (await session.events()).some((line) => line.endsWith("state active=true tool=true")) ? true : null
      },
      "Ask User Form is active and its tool is registered without being called",
      60_000
    )
  } finally {
    await session.close()
  }
})
