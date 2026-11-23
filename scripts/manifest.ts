import { readFile, writeFile } from "node:fs/promises"
import { askUserFormDescription, formSpecJsonSchema } from "../src/core/tool.ts"

const file = new URL("../package.json", import.meta.url)
const check = process.argv.includes("--check")

const inputSchema = formSpecJsonSchema

const original = await readFile(file, "utf8")
const pkg = JSON.parse(original) as {
  contributes: { languageModelTools: Array<Record<string, unknown>> }
}
const tool = pkg.contributes.languageModelTools[0]
if (tool === undefined) {
  throw new Error("languageModelTools[0] is missing")
}
tool["modelDescription"] = askUserFormDescription
tool["inputSchema"] = inputSchema
const next = `${JSON.stringify(pkg, undefined, 2)}\n`

if (check) {
  if (next !== original) {
    process.stderr.write("package.json is out of date. Run: pnpm manifest\n")
    process.exitCode = 1
  }
} else {
  await writeFile(file, next)
}
