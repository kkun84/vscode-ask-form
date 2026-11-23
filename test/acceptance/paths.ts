import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const root = fileURLToPath(new URL("../..", import.meta.url))
export const extension = join(root, "out/extension")
export const driver = join(root, "out/e2e-driver")
export const vsix = join(root, "out/ask-user-form.vsix")
export const driverVsix = join(root, "out/e2e-driver.vsix")
export const sdkCache = join(root, "node_modules/.cache/ask-user-form-agent-sdk")
export const remoteSshCache = join(root, "node_modules/.cache/ask-user-form-remote-ssh")
export const serverCache = join(root, "node_modules/.cache/ask-user-form-vscode-server")

export const electron = (): string => {
  const executable = process.env["VSCODE_ELECTRON"]
  if (executable === undefined) {
    throw new Error("VSCODE_ELECTRON is not set. Run inside `nix develop .#acceptance`.")
  }
  return executable
}
