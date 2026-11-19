import * as vscode from "vscode"
import { createFormPanels, registerFormTool } from "../shared/formTool.ts"

export const activate = (context: vscode.ExtensionContext): void => {
  const panels = createFormPanels()
  context.subscriptions.push(panels, registerFormTool(panels))
}

export const deactivate = (): void => undefined
