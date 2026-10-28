import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import type { Frame } from "@playwright/test"

interface AxeResults {
  readonly violations: ReadonlyArray<{
    readonly id: string
    readonly nodes: ReadonlyArray<{ readonly target: ReadonlyArray<string> }>
  }>
}

const source = readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")

export default class AxeBuilder {
  private readonly frame: Frame

  constructor(frame: Frame) {
    this.frame = frame
  }

  async analyze(): Promise<AxeResults> {
    await this.frame.evaluate(await source)
    return this.frame.evaluate(() =>
      (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<AxeResults> } }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }
      })
    )
  }
}
