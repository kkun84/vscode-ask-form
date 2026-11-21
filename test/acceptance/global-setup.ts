import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { bundle } from "../../scripts/bundle.ts"
import { buildDriver } from "./driver-build.ts"
import { driver, driverVsix, extension, root, vsix, webHost } from "./paths.ts"

const pack = (directory: string, target: string, extra: ReadonlyArray<string> = []): void => {
  execFileSync("pnpm", ["dlx", "@vscode/vsce@4.0.0", "package", "--no-dependencies", ...extra, "--out", target], {
    cwd: directory,
    stdio: ["ignore", "ignore", "inherit"]
  })
}

export default async (): Promise<void> => {
  await buildDriver(root, driver)
  const host = await bundle({ input: `${root}/test/acceptance/web-host.ts`, platform: "browser", format: "cjs" })
  await writeFile(webHost, host.code)
  pack(extension, vsix)
  pack(driver, driverVsix, ["--allow-missing-repository", "--skip-license"])
}
