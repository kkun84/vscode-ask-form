import { execFileSync } from "node:child_process"
import { buildDriver } from "./driver-build.ts"
import { driver, driverVsix, extension, root, vsix } from "./paths.ts"

const pack = (directory: string, target: string, extra: ReadonlyArray<string> = []): void => {
  execFileSync("pnpm", ["dlx", "@vscode/vsce@4.0.0", "package", "--no-dependencies", ...extra, "--out", target], {
    cwd: directory,
    stdio: ["ignore", "ignore", "inherit"]
  })
}

export default async (): Promise<void> => {
  await buildDriver(root, driver)
  pack(extension, vsix)
  pack(driver, driverVsix, ["--allow-missing-repository", "--skip-license"])
}
