import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"
import { withGitRepo } from "../support/git-repo.ts"

const entry = fileURLToPath(new URL("../../scripts/media-check.ts", import.meta.url))

test("SPEC-REL-003 画面のコードを変えて画像を撮り直していなければ失敗し、撮り直せば通る", () =>
  withGitRepo("media-check-", async ({ cwd, git, run }) => {
    await mkdir(join(cwd, "src/ui"), { recursive: true })
    await mkdir(join(cwd, "docs/images"), { recursive: true })
    await writeFile(join(cwd, "src/ui/app.ts"), "a\n")
    await writeFile(join(cwd, "docs/images/form.png"), "a\n")
    git("add", ".")
    git("commit", "-qm", "base")
    const base = git("rev-parse", "HEAD").trim()
    await writeFile(join(cwd, "src/ui/app.ts"), "b\n")
    git("commit", "-qam", "ui")
    const stale = run(entry, base)
    assert.equal(stale.status, 1)
    assert.match(stale.stderr, /pnpm media.*no-media/)
    await writeFile(join(cwd, "docs/images/form.png"), "b\n")
    git("commit", "-qam", "media")
    assert.equal(run(entry, base).status, 0)
  }))
