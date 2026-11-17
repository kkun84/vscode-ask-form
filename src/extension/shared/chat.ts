import * as vscode from "vscode"

export const writeAttachment = async (storage: vscode.Uri, id: string, name: string, body: string): Promise<vscode.Uri> => {
  const directory = vscode.Uri.joinPath(storage, "answers", id)
  await vscode.workspace.fs.createDirectory(directory)
  const file = vscode.Uri.joinPath(directory, name)
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(body))
  return file
}
