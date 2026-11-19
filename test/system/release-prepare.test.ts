import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"

const entry = fileURLToPath(new URL("../../scripts/release-prepare.ts", import.meta.url))

test("SPEC-REL-001 未リリースの項目があれば版数と変更履歴を書き換え、なければ何もしない", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "release-prepare-"))
  const env = { ...process.env }
  delete env["GITHUB_OUTPUT"]
  try {
    const manifest = '{\n  "name": "ask-form",\n  "version": "0.3.0",\n  "dependencies": { "x": "0.3.0" }\n}\n'
    await writeFile(join(cwd, "package.json"), manifest)
    await writeFile(join(cwd, "CHANGELOG.md"), "# 変更履歴\n\n## 未リリース\n\n### 追加\n\n- 新機能\n\n## 0.3.0\n\n- 過去\n")
    assert.equal(execFileSync(process.execPath, [entry], { cwd, env, encoding: "utf8" }), "version=0.3.1\n")
    assert.equal(await readFile(join(cwd, "package.json"), "utf8"), manifest.replace('"version": "0.3.0"', '"version": "0.3.1"'))
    assert.equal(
      await readFile(join(cwd, "CHANGELOG.md"), "utf8"),
      "# 変更履歴\n\n## 未リリース\n\n## 0.3.1\n\n### 追加\n\n- 新機能\n\n## 0.3.0\n\n- 過去\n"
    )
    const output = join(cwd, "output")
    await writeFile(output, "")
    assert.equal(execFileSync(process.execPath, [entry], { cwd, env: { ...env, GITHUB_OUTPUT: output }, encoding: "utf8" }), "")
    assert.equal(await readFile(output, "utf8"), "")
    assert.match(await readFile(join(cwd, "package.json"), "utf8"), /"version": "0.3.1"/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
