import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { bundle } from "../../scripts/bundle.ts"

export const buildDriver = async (root: string, driver: string): Promise<void> => {
  const built = await bundle({ input: join(root, "test/acceptance/driver.ts"), platform: "node", format: "cjs" })
  await mkdir(driver, { recursive: true })
  await writeFile(join(driver, "driver.cjs"), built.code)
  await writeFile(
    join(driver, "package.json"),
    JSON.stringify({
      name: "ask-form-e2e-driver",
      publisher: "kkun84",
      version: "0.0.0",
      engines: { vscode: "^1.110.0" },
      main: "./driver.cjs",
      extensionKind: ["ui", "workspace"],
      activationEvents: ["onStartupFinished"],
      contributes: {
        commands: [
          { command: "ask-form-e2e.newChat", title: "Ask Form: New acceptance chat" },
          { command: "ask-form-e2e.autoReply", title: "Ask Form: Toggle acceptance auto reply" },
          { command: "ask-form-e2e.claude", title: "Ask Form: New acceptance Claude session" },
          { command: "ask-form-e2e.codex", title: "Ask Form: New acceptance Codex session" },
          { command: "ask-form-e2e.copilot", title: "Ask Form: New acceptance Copilot session" },
          { command: "ask-form-e2e.agentsWindow", title: "Ask Form: Open acceptance Agents window" },
          { command: "ask-form-e2e.state", title: "Ask Form: Report acceptance state" },
          { command: "ask-form-e2e.invoke", title: "Ask Form: Invoke acceptance form" },
          { command: "ask-form-e2e.invokeKinds", title: "Ask Form: Show every question type" },
          { command: "ask-form-e2e.theme.light", title: "Ask Form: Use the light theme for acceptance" },
          { command: "ask-form-e2e.theme.dark", title: "Ask Form: Use the dark theme for acceptance" },
          { command: "ask-form-e2e.theme.contrast", title: "Ask Form: Use the high contrast theme for acceptance" },
          { command: "ask-form-e2e.cancel", title: "Ask Form: Cancel acceptance form" }
        ],
        languageModelTools: [
          {
            name: "e2e_tool_search",
            toolReferenceName: "toolSearch",
            displayName: "E2E tool search",
            modelDescription: "Search for relevant tools by describing what you need.",
            inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
          }
        ]
      }
    })
  )
}
