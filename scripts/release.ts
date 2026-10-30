export const checkRelease = (version: string, tag: string, changelog: string) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (match === null || match[0] !== version) {
    throw new Error("Version must be plain major.minor.patch")
  }
  if (tag !== `v${version}`) {
    throw new Error("Tag must match the package version")
  }
  const sections = changelog.replaceAll("\r\n", "\n").split(/^## /m)
  const section = sections.slice(1).find((candidate) => candidate.split("\n", 1)[0]?.trimEnd() === version)
  const notes = section?.slice(section.indexOf("\n") + 1).trim() ?? ""
  if (!/^\s*[-*+]\s+\S/m.test(notes)) {
    throw new Error("CHANGELOG must contain a version section with at least one bullet")
  }
  return { prerelease: BigInt(match[2] ?? "0") % 2n === 1n, notes }
}
