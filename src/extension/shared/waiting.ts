import * as vscode from "vscode"
import { waitingLabel } from "./labels.ts"

export interface WaitingStatus extends vscode.Disposable {
  readonly update: (waiting: number) => void
}

const showFormCommand = "askForm.showWaitingForm"

export const createWaitingStatus = (showForm?: () => void): WaitingStatus => {
  const label = waitingLabel()
  const item = vscode.window.createStatusBarItem("ask-form.waiting", vscode.StatusBarAlignment.Right, 1000)
  item.name = label
  item.text = `$(comment-discussion) ${label}`
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
  item.command = showForm === undefined ? "workbench.action.chat.open" : showFormCommand
  const command = showForm === undefined ? undefined : vscode.commands.registerCommand(showFormCommand, showForm)
  item.accessibilityInformation = { label, role: "status" }
  return {
    update: (waiting) => {
      if (waiting > 0) {
        item.show()
      } else {
        item.hide()
      }
    },
    dispose: () => {
      command?.dispose()
      item.dispose()
    }
  }
}
