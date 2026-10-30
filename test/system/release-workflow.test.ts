import assert from "node:assert/strict"
import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")

test("ARCH-REL-001 読み取り専用の検出後に公開しワークフロー全体を直列化する", () => {
  assert.match(workflow, /concurrency:\n  group: release\n  cancel-in-progress: false/)
  const detect = workflow.split("  release:\n")[0] ?? ""
  assert.match(detect, /jobs:\n  detect:/)
  assert.match(detect, /    permissions:\n      contents: read/)
  assert.doesNotMatch(detect, /contents: write/)
  assert.match(workflow, /  release:\n    needs: detect\n    if: needs.detect.outputs.release == 'true'/)
})

test("SPEC-REL-001 originのタグがない場合だけ公開し照会失敗を伝える", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-detect-"))
  const script = workflow.split("        run: |\n")[1]?.split("  release:\n")[0]
  assert.ok(script)
  try {
    for (const status of [0, 2, 128]) {
      const output = join(directory, `${status}.txt`)
      const result: SpawnSyncReturns<string> = spawnSync(
        "bash",
        [
          "-euo",
          "pipefail",
          "-c",
          `node() { printf '1.2.3'; }\ngit() { [[ "$*" == 'ls-remote --exit-code --tags origin refs/tags/v1.2.3' ]] || exit 99; return ${status}; }\n${script}`
        ],
        { env: { ...process.env, GITHUB_OUTPUT: output }, encoding: "utf8" }
      )
      assert.ifError(result.error)
      assert.equal(result.status, status === 128 ? 128 : 0, result.stderr)
      assert.equal(await readFile(output, "utf8"), `version=1.2.3\ntag=v1.2.3\n${status === 128 ? "" : `release=${status === 2}\n`}`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
