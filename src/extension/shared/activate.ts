import * as vscode from "vscode"
import { registerFormTool } from "./formTool.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(registerFormTool())
}

export const deactivate = (): void => undefined
