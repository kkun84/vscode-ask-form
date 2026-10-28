import * as vscode from "vscode"
import { languageOf } from "../../core/messages.ts"

export const waitingLabel = (): string =>
  languageOf(vscode.env.language) === "ja" ? "Copilotが回答を待っています" : "Copilot is waiting for your answer"
