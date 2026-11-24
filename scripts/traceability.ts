import { fileURLToPath } from "node:url"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

type Level = "REQ" | "SPEC" | "ARCH" | "DES"

interface Item {
  readonly id: string
  readonly level: Level
  readonly title: string
  readonly file: string
  readonly parents: ReadonlyArray<string>
  readonly verifiedBy: ReadonlyArray<string>
}

interface Evidence {
  readonly id: string
  readonly kind: "unit" | "architecture" | "system" | "acceptance"
  readonly where: string
}

const root = fileURLToPath(new URL("..", import.meta.url))
const idPattern = /(?:REQ|SPEC|ARCH|DES)-[A-Z0-9]+-\d{3}/g
const docs = ["docs/spec/requirements.md", "docs/spec/system.md", "docs/design/architecture.md", "docs/design/detailed.md"]
const output = "docs/traceability.md"

const parentLevels: Readonly<Record<Level, ReadonlyArray<Level>>> = {
  REQ: [],
  SPEC: ["REQ"],
  ARCH: ["SPEC"],
  DES: ["SPEC", "ARCH"]
}

const evidenceKinds: Readonly<Record<Level, ReadonlyArray<Evidence["kind"]>>> = {
  REQ: ["acceptance"],
  SPEC: ["system"],
  ARCH: ["architecture", "system"],
  DES: ["unit"]
}

const levelOf = (id: string): Level => id.slice(0, id.indexOf("-")) as Level

const parseDoc = async (file: string): Promise<ReadonlyArray<Item>> => {
  const lines = (await readFile(join(root, file), "utf8")).split("\n")
  const items: Array<Item> = []
  let current: { id: string; title: string; parents: Array<string>; verifiedBy: Array<string> } | undefined
  const flush = () => {
    if (current !== undefined) {
      items.push({ ...current, level: levelOf(current.id), file })
    }
  }
  for (const line of lines) {
    const heading = /^### ((?:REQ|SPEC|ARCH|DES)-[A-Z0-9]+-\d{3}) (.+)$/.exec(line)
    if (heading !== null) {
      flush()
      current = { id: heading[1] ?? "", title: heading[2] ?? "", parents: [], verifiedBy: [] }
    } else if (current !== undefined && line.startsWith("派生元: ")) {
      current.parents.push(...(line.match(idPattern) ?? []))
    } else if (current !== undefined && line.startsWith("検証: ")) {
      current.verifiedBy.push(...(line.match(idPattern) ?? []))
    }
  }
  flush()
  return items
}

const walk = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(join(root, directory), { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : Promise.resolve([join(directory, entry.name)])))
  )
  return nested.flat()
}

const kindOf = (file: string): Evidence["kind"] | undefined => {
  const [, folder] = file.split("/")
  return folder === "unit" || folder === "architecture" || folder === "system" || folder === "acceptance" ? folder : undefined
}

const testEvidence = async (): Promise<ReadonlyArray<Evidence>> => {
  const files = (await walk("test")).filter((file) => file.endsWith(".ts"))
  const found = await Promise.all(
    files.map(async (file) => {
      const kind = kindOf(file)
      if (kind === undefined) {
        return []
      }
      const text = await readFile(join(root, file), "utf8")
      return [...text.matchAll(/\b(?:it|test)\(\s*["'`]((?:REQ|SPEC|ARCH|DES)-[A-Z0-9]+-\d{3}) /g)].map((match) => ({
        id: match[1] ?? "",
        kind,
        where: file
      }))
    })
  )
  return found.flat()
}

const items = (await Promise.all(docs.map((doc) => parseDoc(doc)))).flat()
const evidence = await testEvidence()
const byId = new Map(items.map((item) => [item.id, item]))
const problems: Array<string> = []

for (const item of items) {
  if (items.filter((other) => other.id === item.id).length > 1) {
    problems.push(`${item.id}: 同じIDが複数あります`)
  }
  if (item.level !== "REQ" && item.parents.length === 0) {
    problems.push(`${item.id}: 派生元がありません`)
  }
  for (const parent of item.parents) {
    const found = byId.get(parent)
    if (found === undefined) {
      problems.push(`${item.id}: 派生元 ${parent} がありません`)
    } else if (!parentLevels[item.level].includes(found.level)) {
      problems.push(`${item.id}: ${parent} は派生元にできない段階です`)
    }
  }
  if (item.level === "REQ" && !items.some((other) => other.level === "SPEC" && other.parents.includes(item.id))) {
    problems.push(`${item.id}: この要求を満たすシステム仕様がありません`)
  }
  const allowed = evidenceKinds[item.level]
  const mine = evidence.filter((entry) => entry.id === item.id)
  for (const spec of item.verifiedBy) {
    const found = byId.get(spec)
    if (item.level !== "REQ") {
      problems.push(`${item.id}: 検証にIDを書けるのは要求仕様だけです`)
    } else if (found?.level !== "SPEC" || !found.parents.includes(item.id)) {
      problems.push(`${item.id}: 検証の ${spec} は、この要求から派生したシステム仕様ではありません`)
    } else if (!evidence.some((entry) => entry.id === spec && entry.kind === "system")) {
      problems.push(`${item.id}: 検証の ${spec} にシステムテストがありません`)
    }
  }
  if (!mine.some((entry) => allowed.includes(entry.kind)) && item.verifiedBy.length === 0) {
    problems.push(`${item.id}: 検証(${allowed.join("か")})がありません`)
  }
  for (const entry of mine.filter((candidate) => !allowed.includes(candidate.kind))) {
    problems.push(`${item.id}: ${entry.where} は${item.level}を検証する段階のテストではありません`)
  }
}

for (const entry of evidence) {
  if (!byId.has(entry.id)) {
    problems.push(`${entry.where}: ${entry.id} は文書にないIDです`)
  }
}

const cell = (values: ReadonlyArray<string>) => (values.length === 0 ? "-" : values.join(", "))

const verification = (item: Item): ReadonlyArray<string> => [
  ...new Set(evidence.filter((entry) => entry.id === item.id).map((entry) => `\`${entry.where}\``)),
  ...item.verifiedBy
]

const sections: ReadonlyArray<readonly [Level, string]> = [
  ["REQ", "要求仕様"],
  ["SPEC", "システム仕様"],
  ["ARCH", "アーキテクチャ設計"],
  ["DES", "詳細設計"]
]

const table = sections
  .map(([level, heading]) => {
    const rows = items
      .filter((item) => item.level === level)
      .map((item) => {
        const children = items.filter((other) => other.parents.includes(item.id)).map((other) => other.id)
        return `| ${item.id} | ${item.title} | ${cell(item.parents)} | ${cell(children)} | ${cell(verification(item))} |`
      })
    return [`## ${heading}`, "", "| ID | 名前 | 派生元 | 派生先 | 検証 |", "| --- | --- | --- | --- | --- |", ...rows].join("\n")
  })
  .join("\n\n")

const report = `# トレーサビリティ

\`node scripts/traceability.ts --write\`で生成します。手で編集しません。

${table}
`

if (problems.length > 0) {
  process.stderr.write(`トレーサビリティの問題:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`)
  process.exitCode = 1
} else if (process.argv.includes("--write")) {
  await writeFile(join(root, output), report)
} else {
  const current = await readFile(join(root, output), "utf8").catch(() => "")
  if (current !== report) {
    process.stderr.write(
      `${relative(root, join(root, output))} が古くなっています。node scripts/traceability.ts --write を実行してください。\n`
    )
    process.exitCode = 1
  }
}
