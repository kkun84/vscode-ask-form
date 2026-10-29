import * as vscode from "vscode"

export interface WaitingStatus extends vscode.Disposable {
  readonly update: (waiting: number) => void
}

export const createWaitingStatus = (label: string): WaitingStatus => {
  const item = vscode.window.createStatusBarItem("ask-form.waiting", vscode.StatusBarAlignment.Right, 1000)
  item.name = label
  item.text = `$(comment-discussion) ${label}`
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
  item.command = "workbench.action.chat.open"
  item.accessibilityInformation = { label, role: "status" }
  return {
    update: (waiting) => {
      if (waiting > 0) {
        item.show()
      } else {
        item.hide()
      }
    },
    dispose: () => item.dispose()
  }
}
