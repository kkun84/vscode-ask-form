import { execFileSync } from "node:child_process"

const tsgo =
  execFileSync("effect-tsgo", ["get-exe-path"], { encoding: "utf8", shell: process.platform === "win32" })
    .trim()
    .split("\n")
    .at(-1) ?? ""

for (const project of ["tsconfig.json", "tsconfig.browser.json"]) {
  execFileSync(tsgo, ["-p", project], { stdio: "inherit" })
}
