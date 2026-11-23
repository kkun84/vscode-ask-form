import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { buildDriver } from "./driver-build.ts"
import { driver, driverVsix, extension, root, vsix } from "./paths.ts"

const pack = (directory: string, target: string, extra: ReadonlyArray<string> = []): void => {
  execFileSync(join(root, "node_modules/.bin/vsce"), ["package", "--no-dependencies", ...extra, "--out", target], {
    cwd: directory,
    stdio: ["ignore", "ignore", "inherit"]
  })
}

export default async (): Promise<void> => {
  await buildDriver(root, driver)
  pack(extension, vsix)
  pack(driver, driverVsix, ["--allow-missing-repository", "--skip-license"])
}
