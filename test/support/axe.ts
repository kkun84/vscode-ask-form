import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { expect, type Frame } from "@playwright/test"

interface AxeResults {
  readonly violations: ReadonlyArray<{
    readonly id: string
    readonly nodes: ReadonlyArray<{ readonly target: ReadonlyArray<string> }>
  }>
}

const source = readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")

class AxeBuilder {
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

export const axeViolations = async (frame: Frame): Promise<ReadonlyArray<string>> => {
  await expect.poll(() => frame.evaluate(() => document.getAnimations().length)).toBe(0)
  const results = await new AxeBuilder(frame).analyze()
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
}
