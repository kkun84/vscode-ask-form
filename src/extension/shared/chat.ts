import * as vscode from "vscode"
import { attachmentName, type Values } from "../../core/form.ts"

export interface ChatPostRequest {
  readonly text: string
  readonly title: string
  readonly values: Values
}

export const writeAttachment = async (storage: vscode.Uri, id: string, name: string, body: string): Promise<vscode.Uri> => {
  const directory = vscode.Uri.joinPath(storage, "answers", id)
  await vscode.workspace.fs.createDirectory(directory)
  const file = vscode.Uri.joinPath(directory, name)
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(body))
  return file
}

export const postToChat = async (storage: vscode.Uri, request: ChatPostRequest): Promise<void> => {
  const body = JSON.stringify({ title: request.title, values: request.values }, undefined, 2)
  const file = await writeAttachment(storage, crypto.randomUUID(), attachmentName(request.title), body)
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query: request.text,
    isPartialQuery: true,
    attachFiles: [file]
  })
}
