import type { Page } from "@playwright/test"

type Body<S> = (session: S) => Promise<void>

export interface Steps<S> {
  readonly test: (name: string, body: Body<S>) => void
  readonly run: (session: S, onFailure: () => Promise<void>) => Promise<void>
}

export const createSteps = <S>(): Steps<S> => {
  const steps: Array<{ readonly name: string; readonly body: Body<S> }> = []
  return {
    test: (name, body) => {
      steps.push({ name, body })
    },
    run: async (session, onFailure) => {
      for (const { name, body } of steps) {
        try {
          await body(session)
          console.log(`ok ${name}`)
        } catch (error) {
          console.error(`not ok ${name}`)
          await onFailure()
          throw error
        }
      }
    }
  }
}

export const waitingStatus = (window: Page) => window.locator(".statusbar-item", { hasText: "Copilot is waiting for your answer" })

export const printChat = async (window: Page): Promise<void> => {
  const chat = await window
    .locator(".interactive-session")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "(no chat text)")
  console.error(`chat panel: ${chat.replaceAll(/\s+/g, " ").slice(0, 1500)}`)
}
