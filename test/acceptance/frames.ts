import type { Frame, Page } from "@playwright/test"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const until = async <T>(probe: () => Promise<T | null | undefined>, message: string, timeoutMs: number): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined && value !== null) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out: ${message}`)
    }
    await sleep(250)
  }
}

export const formFrame = (window: Page, previous: ReadonlyArray<Frame> = []): Promise<Frame> =>
  until(
    async () => {
      for (const frame of window.frames().filter((candidate) => !previous.includes(candidate))) {
        const found = await frame
          .locator("form.card button.primary")
          .count()
          .catch(() => 0)
        if (found > 0) {
          return frame
        }
      }
      return null
    },
    "the form appears",
    120_000
  )
