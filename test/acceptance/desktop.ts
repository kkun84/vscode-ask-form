import * as vscode from "vscode"
import { check, eventually, extension, run, test } from "./harness.ts"

test("REQ-PERF-001 デスクトップ版は起動完了後に自動で有効になる", async () => {
  const target = extension()
  await eventually(() => target.isActive, "the extension becomes active after startup")
  check(!vscode.lm.tools.some((tool) => tool.name === "copilot_forms_ask_form"), "the panel tool is disabled on desktop")
})

export { run }
