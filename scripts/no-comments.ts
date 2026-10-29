import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { parseSync } from "oxc-parser"

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(ts|cjs|mjs|js|css|html|nix)$/.test(file))

const scriptComments = (file: string, text: string): ReadonlyArray<number> => parseSync(file, text).comments.map((comment) => comment.start)

const patternComments = (text: string, pattern: RegExp): ReadonlyArray<number> => [...text.matchAll(pattern)].map((match) => match.index)

const commentsIn = (file: string, text: string): ReadonlyArray<number> => {
  if (file.endsWith(".css")) {
    return patternComments(text, /\/\*/g)
  }
  if (file.endsWith(".html")) {
    return patternComments(text, /<!--/g)
  }
  if (file.endsWith(".nix")) {
    return patternComments(text, /(^|\s)#/gm)
  }
  return scriptComments(file, text)
}

const lineOf = (text: string, offset: number) => text.slice(0, offset).split("\n").length

const problems: Array<string> = []
for (const file of tracked) {
  const text = await readFile(file, "utf8")
  for (const offset of commentsIn(file, text)) {
    problems.push(`${file}:${lineOf(text, offset)}`)
  }
}

if (problems.length > 0) {
  process.stderr.write(`コメントは書かない決まりです:\n${problems.join("\n")}\n`)
  process.exit(1)
}
