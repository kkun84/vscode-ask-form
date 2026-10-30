import { readFile } from "node:fs/promises"
import { runCommand } from "./process.ts"

interface Budgets {
  readonly time: Readonly<Record<string, number>>
}

const [name = "", ...command] = process.argv.slice(2)
const budgets = JSON.parse(await readFile(new URL("../budgets.json", import.meta.url), "utf8")) as Budgets
const limit = budgets.time[name]
const [program, ...args] = command

if (limit === undefined || program === undefined) {
  process.stderr.write(`usage: timed.ts <${Object.keys(budgets.time).join("|")}> <command...>\n`)
  process.exit(2)
}

const started = performance.now()
const code = await runCommand(program, args, limit * 1000)
const seconds = (performance.now() - started) / 1000
const over = seconds > limit
process.stdout.write(`${over ? "over" : "ok  "} ${name} ${seconds.toFixed(1)}s / ${limit}s\n`)
process.exitCode = over ? 1 : code
