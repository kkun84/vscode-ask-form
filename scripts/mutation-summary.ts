import { readFileSync } from "node:fs"
import { summarize } from "./mutation-report.ts"
import { emit } from "./mutation-run.ts"

const [log = "", status = "0"] = process.argv.slice(2)
emit(summarize(readFileSync(log === "-" ? 0 : log, "utf8"), status !== "0"))
