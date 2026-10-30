import { appendFile, readFile, writeFile } from "node:fs/promises"
import { checkRelease } from "./release.ts"

const manifest = JSON.parse(await readFile("package.json", "utf8")) as { version: string }
const release = checkRelease(manifest.version, process.argv[2] ?? "", await readFile("CHANGELOG.md", "utf8"))
const output = `prerelease=${release.prerelease}\n`
const destination = process.env["GITHUB_OUTPUT"]
if (destination === undefined) {
  process.stdout.write(output)
} else {
  await appendFile(destination, output)
}
const notesFile = process.argv[3]
if (notesFile !== undefined) {
  await writeFile(notesFile, `${release.notes}\n`)
}
