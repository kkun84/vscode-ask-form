import type * as Vscode from "vscode"
import { withVscode } from "./source.ts"
import { createVscode } from "./vscode-stub.ts"

export const loadDesktopAttachments = async () => {
  const { vscode, recorder } = createVscode()
  const { attachmentStore } = await withVscode(vscode, () => import("../../src/extension/node/attachments.ts"))
  const api = vscode as typeof Vscode
  return { recorder, api, layer: attachmentStore(api.Uri.parse("/storage")) }
}
