import * as vscode from "vscode"
import type { Values } from "../../core/form.ts"

export interface ChatPostRequest {
  readonly text: string
  readonly title: string
  readonly values: Values
}

const fileName = (title: string): string => {
  const slug = title
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return `${slug === "" ? "form" : slug}.json`
}

export const postToChat = async (storage: vscode.Uri, request: ChatPostRequest): Promise<void> => {
  const directory = vscode.Uri.joinPath(storage, "answers")
  await vscode.workspace.fs.createDirectory(directory)
  const file = vscode.Uri.joinPath(directory, fileName(request.title))
  const body = JSON.stringify({ title: request.title, values: request.values }, undefined, 2)
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(body))
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query: request.text,
    isPartialQuery: false,
    preserveInput: true,
    attachFiles: [file]
  })
}
