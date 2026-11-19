import { readFile, writeFile } from "node:fs/promises"
import { writeOutput } from "./github-output.ts"
import { prepareRelease } from "./release.ts"

const text = await readFile("package.json", "utf8")
const manifest = JSON.parse(text) as { version: string }
const prepared = prepareRelease(manifest.version, await readFile("CHANGELOG.md", "utf8"))
if (prepared !== undefined) {
  const field = `"version": "${manifest.version}"`
  if (!text.includes(field)) {
    throw new Error(`package.json must contain ${field}`)
  }
  await writeFile("package.json", text.replace(field, `"version": "${prepared.version}"`))
  await writeFile("CHANGELOG.md", prepared.changelog)
  await writeOutput(`version=${prepared.version}\n`)
}
