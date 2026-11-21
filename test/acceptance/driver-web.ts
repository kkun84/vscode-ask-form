import type * as vscode from "vscode"
import { registerCommands } from "./driver-commands.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  registerCommands(context, (line) => {
    console.log(`ask-form-e2e ${line}`)
  })
}

export const deactivate = (): void => undefined
