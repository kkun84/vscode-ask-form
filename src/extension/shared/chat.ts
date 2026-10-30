import * as vscode from "vscode"
import { attachmentName, type Values } from "../../core/form.ts"

export interface ChatPostRequest {
  readonly text: string
  readonly title: string
  readonly values: Values
}

export const postToChat = async (storage: vscode.Uri, request: ChatPostRequest): Promise<void> => {
  const directory = vscode.Uri.joinPath(storage, "answers", crypto.randomUUID())
  await vscode.workspace.fs.createDirectory(directory)
  const file = vscode.Uri.joinPath(directory, attachmentName(request.title))
  const body = JSON.stringify({ title: request.title, values: request.values }, undefined, 2)
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(body))
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query: request.text,
    isPartialQuery: true,
    attachFiles: [file]
  })
}
