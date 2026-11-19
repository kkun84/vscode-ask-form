import { onTestFinished } from "vitest"

export const useWindow = (value: unknown): void => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value })
  onTestFinished(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "window")
    } else {
      Object.defineProperty(globalThis, "window", previous)
    }
  })
}
