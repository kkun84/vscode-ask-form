import * as vscode from "vscode"
import { commentPresetsFrom } from "../../core/form.ts"

export const commentPresets = (): ReadonlyArray<string> | undefined =>
  commentPresetsFrom(vscode.workspace.getConfiguration("askForm").get<unknown>("commentPresets"))
