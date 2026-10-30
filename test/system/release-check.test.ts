import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const entry = fileURLToPath(new URL("../../scripts/release-check.ts", import.meta.url))

test("SPEC-REL-001 CLIが配布種別と対象版の説明を出力し不備を拒否する", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "release-check-"))
  const env = { ...process.env }
  delete env["GITHUB_OUTPUT"]
  try {
    await writeFile(join(cwd, "package.json"), JSON.stringify({ version: "0.1.0" }))
    await writeFile(join(cwd, "CHANGELOG.md"), "## 0.1.0\n\n- 新機能\n\n## 0.0.0\n\n- 旧版\n")
    const args = [entry, "v0.1.0", "notes.md"]
    assert.equal(execFileSync(process.execPath, args, { cwd, env, encoding: "utf8" }), "prerelease=true\n")
    assert.equal(await readFile(join(cwd, "notes.md"), "utf8"), "- 新機能\n")
    const output = join(cwd, "output")
    await writeFile(output, "existing=value\n")
    assert.equal(execFileSync(process.execPath, args, { cwd, env: { ...env, GITHUB_OUTPUT: output }, encoding: "utf8" }), "")
    assert.equal(await readFile(output, "utf8"), "existing=value\nprerelease=true\n")
    assert.notEqual(spawnSync(process.execPath, [entry, "v0.2.0"], { cwd, env }).status, 0)
    await writeFile(join(cwd, "package.json"), JSON.stringify({ version: "0.2.1" }))
    await writeFile(join(cwd, "CHANGELOG.md"), "## 0.2.1\n- 修正\n")
    assert.equal(execFileSync(process.execPath, [entry, "v0.2.1"], { cwd, env, encoding: "utf8" }), "prerelease=false\n")
    await writeFile(join(cwd, "CHANGELOG.md"), "## 0.2.1\n")
    assert.notEqual(spawnSync(process.execPath, [entry, "v0.2.1"], { cwd, env }).status, 0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
