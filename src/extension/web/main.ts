import * as vscode from "vscode"
import { registerFormTool } from "../shared/formTool.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(registerFormTool(context))
}

export const deactivate = (): void => undefined
