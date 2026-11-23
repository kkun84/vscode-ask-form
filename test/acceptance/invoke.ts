import { expect, type Frame, type TestInfo } from "@playwright/test"
import { runCommand } from "./commands.ts"
import { attachDiagnostics } from "./fixtures.ts"
import { formFrame, until } from "./frames.ts"
import type { Session } from "./session.ts"

export interface Invoked {
  readonly frame: Frame
  readonly result: () => Promise<string>
}

export const invokeForm = async (session: Session, title = "Ask User Form: Invoke acceptance form"): Promise<Invoked> => {
  const previous = session.window.frames()
  const index = (await session.events()).filter((line) => / invoked \d+$/.test(` ${line}`)).length + 1
  await runCommand(session.window, title)
  const frame = await formFrame(session.window, previous)
  const marker = `result ${index} `
  return {
    frame,
    result: () =>
      until(
        async () => {
          const line = (await session.events()).find((entry) => entry.includes(marker))
          return line === undefined ? null : (JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as string)
        },
        `the tool call ${index} settles`,
        60_000
      )
  }
}

export const closed = (frame: Frame) => expect.poll(() => frame.isDetached(), { timeout: 30_000 }).toBe(true)

export const cancelForm = async (session: Session, testInfo: TestInfo): Promise<void> => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await attachDiagnostics(session, testInfo)
  }
  await runCommand(session.window, "Ask User Form: Cancel acceptance form")
}
