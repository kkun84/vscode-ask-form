import type { Page } from "@playwright/test"

export const completeWebRun = async (page: Pick<Page, "exposeFunction">, answer: () => Promise<void>): Promise<void> => {
  let finish!: (code: number) => void
  const exit = new Promise<void>((resolve, reject) => {
    finish = (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`web acceptance tests failed with exit code ${code}`))
      }
    }
  })
  await Promise.all([exit, page.exposeFunction("codeAutomationExit", finish).then(answer)])
}
