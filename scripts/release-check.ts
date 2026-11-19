import { readFile, writeFile } from "node:fs/promises"
import { writeOutput } from "./github-output.ts"
import { checkRelease } from "./release.ts"

const manifest = JSON.parse(await readFile("package.json", "utf8")) as { version: string }
const release = checkRelease(manifest.version, process.argv[2] ?? "", await readFile("CHANGELOG.md", "utf8"))
await writeOutput(`prerelease=${release.prerelease}\n`)
const notesFile = process.argv[3]
if (notesFile !== undefined) {
  await writeFile(notesFile, `${release.notes}\n`)
}
