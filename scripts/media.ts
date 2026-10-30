import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { buildDriver } from "../test/acceptance/driver-build.ts"
import { captureMedia } from "../test/acceptance/media.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const driver = join(root, "out/e2e-driver")
const executable = process.env["VSCODE_ELECTRON"]
const cli = process.env["VSCODE_EXECUTABLE"]
if (executable === undefined || cli === undefined) {
  throw new Error("VSCODE_ELECTRON is not set. Run inside `nix develop .#acceptance`.")
}

await buildDriver(root, driver)
await captureMedia({ executable, cli, extension: join(root, "out/extension"), driver, output: join(root, "docs/images") })
