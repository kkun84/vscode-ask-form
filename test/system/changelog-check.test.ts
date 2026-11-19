import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"

const entry = fileURLToPath(new URL("../../scripts/changelog-check.ts", import.meta.url))

test("SPEC-REL-002 種別の無い項目と、基点から増えない未リリースを拒否する", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "changelog-check-"))
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd })
  const check = (...args: ReadonlyArray<string>) => spawnSync(process.execPath, [entry, ...args], { cwd, encoding: "utf8" })
  try {
    git("init", "-q")
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n### 追加\n\n- 既存\n")
    git("add", ".")
    git("commit", "-qm", "base")
    assert.equal(check().status, 0)
    const unchanged = check("HEAD")
    assert.equal(unchanged.status, 1)
    assert.match(unchanged.stderr, /no-changelog/)
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n### 追加\n\n- 既存\n\n### 修正\n\n- 新規\n")
    assert.equal(check("HEAD").status, 0)
    await writeFile(join(cwd, "CHANGELOG.md"), "## 未リリース\n\n- 既存\n- 新規\n")
    const untyped = check()
    assert.equal(untyped.status, 1)
    assert.match(untyped.stderr, /kind heading/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
