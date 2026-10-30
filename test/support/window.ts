import type { TestContext } from "node:test"

export const useWindow = (context: TestContext, value: unknown): void => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value })
  context.after(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "window")
    } else {
      Object.defineProperty(globalThis, "window", previous)
    }
  })
}
