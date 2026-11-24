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
      name: "ask-user-form-e2e-driver",
      publisher: "kkun84",
      version: "0.0.0",
      engines: { vscode: "^1.110.0" },
      main: "./driver.cjs",
      extensionKind: ["ui", "workspace"],
      activationEvents: ["onStartupFinished"],
      contributes: {
        commands: [
          { command: "ask-user-form-e2e.newChat", title: "Ask User Form: New acceptance chat" },
          { command: "ask-user-form-e2e.autoReply", title: "Ask User Form: Toggle acceptance auto reply" },
          { command: "ask-user-form-e2e.claude", title: "Ask User Form: New acceptance Claude session" },
          { command: "ask-user-form-e2e.codex", title: "Ask User Form: New acceptance Codex session" },
          { command: "ask-user-form-e2e.copilot", title: "Ask User Form: New acceptance Copilot session" },
          { command: "ask-user-form-e2e.agentsWindow", title: "Ask User Form: Open acceptance Agents window" },
          { command: "ask-user-form-e2e.state", title: "Ask User Form: Report acceptance state" },
          { command: "ask-user-form-e2e.invoke", title: "Ask User Form: Invoke acceptance form" },
          { command: "ask-user-form-e2e.invokeKinds", title: "Ask User Form: Show every question type" },
          { command: "ask-user-form-e2e.invokeUnrecommended", title: "Ask User Form: Show a question without a recommendation" },
          { command: "ask-user-form-e2e.theme.light", title: "Ask User Form: Use the light theme for acceptance" },
          { command: "ask-user-form-e2e.theme.dark", title: "Ask User Form: Use the dark theme for acceptance" },
          { command: "ask-user-form-e2e.theme.contrast", title: "Ask User Form: Use the high contrast theme for acceptance" },
          { command: "ask-user-form-e2e.cancel", title: "Ask User Form: Cancel acceptance form" }
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
