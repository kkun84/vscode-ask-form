import { readFile, stat } from "node:fs/promises"

interface Budgets {
  readonly size: Readonly<Record<string, number>>
}

const budgets = JSON.parse(await readFile(new URL("../budgets.json", import.meta.url), "utf8")) as Budgets

const results = await Promise.all(
  Object.entries(budgets.size).map(async ([file, limit]) => {
    const { size } = await stat(new URL(`../${file}`, import.meta.url))
    return { file, size, limit }
  })
)

for (const { file, size, limit } of results) {
  process.stdout.write(`${size <= limit ? "ok  " : "over"} ${file} ${size} / ${limit} bytes\n`)
}

if (results.some(({ size, limit }) => size > limit)) {
  process.exitCode = 1
}
