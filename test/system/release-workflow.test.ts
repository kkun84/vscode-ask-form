import assert from "node:assert/strict"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")

test("ARCH-REL-001 読み取り専用の検出後に版数を上げて公開しワークフロー全体を直列化する", () => {
  assert.match(workflow, /concurrency:\n  group: release\n  cancel-in-progress: false/)
  const detect = workflow.split("  bump:\n")[0] ?? ""
  assert.match(detect, /jobs:\n  detect:/)
  assert.match(detect, /    permissions:\n      contents: read/)
  assert.doesNotMatch(detect, /contents: write/)
  const bump = workflow.split("  bump:\n")[1]?.split("  release:\n")[0] ?? ""
  assert.match(bump, /    needs: detect\n    if: needs.detect.outputs.action == 'bump'/)
  assert.match(bump, /    permissions:\n      contents: write\n    outputs:/)
  assert.match(
    workflow,
    /  release:\n    needs: \[detect, bump\]\n    if: \$\{\{ !cancelled\(\) && \(needs.detect.outputs.action == 'release' \|\| needs.bump.outputs.tag != ''\) \}\}/
  )
})

test("SPEC-REL-001 mainの先頭だけを扱い、タグが無ければ公開し、あれば版数を上げ、照会失敗を伝える", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-detect-"))
  const script = workflow.split("        run: |\n")[1]?.split("  bump:\n")[0]
  assert.ok(script)
  try {
    for (const [main, status, action] of [
      ["abc", 0, "bump"],
      ["abc", 2, "release"],
      ["abc", 128, undefined],
      ["def", 2, "none"]
    ] as const) {
      const output = join(directory, `${main}-${status}.txt`)
      const result: SpawnSyncReturns<string> = spawnSync(
        "bash",
        [
          "-euo",
          "pipefail",
          "-c",
          `node() { printf '1.2.3'; }\ngit() {\n  if [[ "$*" == 'ls-remote --exit-code origin refs/heads/main' ]]; then printf '${main}\\trefs/heads/main\\n'; return 0; fi\n  [[ "$*" == 'ls-remote --exit-code --tags origin refs/tags/v1.2.3' ]] || exit 99\n  return ${status}\n}\n${script}`
        ],
        { env: { ...process.env, GITHUB_OUTPUT: output, SHA: "abc" }, encoding: "utf8" }
      )
      assert.ifError(result.error)
      assert.equal(result.status, action === undefined ? 128 : 0, result.stderr)
      assert.equal(
        await readFile(output, "utf8"),
        `version=1.2.3\ntag=v1.2.3\nsha=abc\n${action === undefined ? "" : `action=${action}\n`}`
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
