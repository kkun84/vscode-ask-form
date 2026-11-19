const unreleased = "未リリース"
const kinds = ["追加", "変更", "非推奨", "削除", "修正", "セキュリティ"]
const bullet = /^\s*[-*+]\s+\S/m

const parseVersion = (version: string) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (match === null || match[0] !== version) {
    throw new Error("Version must be plain major.minor.patch")
  }
  return { major: BigInt(match[1] ?? "0"), minor: BigInt(match[2] ?? "0"), patch: BigInt(match[3] ?? "0") }
}

const sectionsOf = (changelog: string) => changelog.replaceAll("\r\n", "\n").split(/^## /m)

const headingOf = (section: string) => section.split("\n", 1)[0]?.trimEnd()

const bodyOf = (section: string) => {
  const newline = section.indexOf("\n")
  return newline === -1 ? "" : section.slice(newline)
}

const unreleasedBody = (changelog: string) => {
  const section = sectionsOf(changelog)
    .slice(1)
    .find((candidate) => headingOf(candidate) === unreleased)
  return section === undefined ? undefined : bodyOf(section)
}

export const checkRelease = (version: string, tag: string, changelog: string) => {
  const { minor } = parseVersion(version)
  if (tag !== `v${version}`) {
    throw new Error("Tag must match the package version")
  }
  const section = sectionsOf(changelog)
    .slice(1)
    .find((candidate) => headingOf(candidate) === version)
  const notes = section === undefined ? "" : bodyOf(section).trim()
  if (!bullet.test(notes)) {
    throw new Error("CHANGELOG must contain a version section with at least one bullet")
  }
  return { prerelease: minor % 2n === 1n, notes }
}

export const prepareRelease = (version: string, changelog: string) => {
  const { major, minor, patch } = parseVersion(version)
  const sections = sectionsOf(changelog)
  const index = sections.findIndex((candidate, position) => position > 0 && headingOf(candidate) === unreleased)
  const body = bodyOf(sections[index] ?? "")
  if (index === -1 || !bullet.test(body)) {
    return
  }
  const next = minor % 2n === 1n ? `${major}.${minor}.${patch + 1n}` : `${major}.${minor + 1n}.0`
  sections[index] = `${unreleased}\n\n## ${next}${body}`
  return { version: next, changelog: sections.join("## ") }
}

const entriesOf = (body: string) =>
  body
    .split("\n")
    .filter((line) => bullet.test(line))
    .map((line) => line.trim())

export const checkChangelog = (changelog: string, base?: string) => {
  const body = unreleasedBody(changelog)
  if (body === undefined) {
    return [`CHANGELOG must contain a "## ${unreleased}" section`]
  }
  const problems: Array<string> = []
  let kind: string | undefined
  for (const line of body.split("\n")) {
    const heading = /^###\s+(.*?)\s*$/.exec(line)
    if (heading !== null) {
      kind = heading[1]
      if (!kinds.includes(kind ?? "")) {
        problems.push(`Unknown kind "${kind}" in "${unreleased}". Use one of: ${kinds.join(", ")}`)
      }
    } else if (bullet.test(line) && kind === undefined) {
      problems.push(`Entry must be under a kind heading in "${unreleased}": ${line.trim()}`)
    }
  }
  if (base !== undefined) {
    const before = new Set(entriesOf(unreleasedBody(base) ?? ""))
    if (!entriesOf(body).some((entry) => !before.has(entry))) {
      problems.push(`Add or change an entry in "${unreleased}" of CHANGELOG.md, or label the pull request no-changelog`)
    }
  }
  return problems
}
