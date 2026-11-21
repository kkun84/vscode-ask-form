import type { Page } from "@playwright/test"
import { until } from "./frames.ts"

export const runCommand = async (page: Page, title: string, focus = true): Promise<void> => {
  const input = page.locator(".quick-input-widget input")
  const row = page.locator(".quick-input-list .monaco-list-row", { hasText: title })
  await until(
    async () => {
      await page.keyboard.press("Escape")
      if (focus) {
        await page.locator(".monaco-workbench").click({ position: { x: 600, y: 400 } })
      }
      await page.keyboard.press("F1")
      if (!(await input.isVisible().catch(() => false))) {
        return null
      }
      await input.fill(`>${title}`)
      return (await row.isVisible().catch(() => false)) ? true : undefined
    },
    `the command palette offers ${title}`,
    120_000
  )
  await row.click()
}
