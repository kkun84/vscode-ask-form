import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "vitest"
import { withGitRepo, type GitRepo } from "../support/git-repo.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

const copied = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/mutation-diff.sh",
  "scripts/mutation-findings.ts",
  "scripts/mutation-report.ts",
  "scripts/mutation-scope.ts",
  "scripts/mutation-vitest-files.ts",
  "scripts/mutation-vitest.ts",
  "scripts/vitest-files.ts"
]

const written: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n.mutator/\n.mutator-base/\n",
  "tsconfig.json": `${JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "Preserve",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: ["node"]
    },
    include: ["src", "test", "scripts"]
  })}\n`,
  "mutator.config.json": `${JSON.stringify({ runner: "vitest", vitestConfig: "vitest.mutation.config.ts", include: ["src/**/*.ts"], reporters: ["json"] })}\n`,
  "vitest.mutation.config.ts":
    'import { defineConfig } from "vitest/config"\n\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } })\n',
  "src/clamp.ts":
    "export const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value)\n",
  "src/twice.ts": "export const twice = (value: number): number => value * 2\n",
  "test/clamp.test.ts": [
    'import { expect, test } from "vitest"',
    'import { clamp } from "../src/clamp.ts"',
    "",
    'test("下限", () => {',
    "  expect(clamp(-1, 0, 10)).toBe(0)",
    "})",
    "",
    'test("上限", () => {',
    "  expect(clamp(11, 0, 10)).toBe(10)",
    "})",
    "",
    'test("範囲内", () => {',
    "  expect(clamp(5, 0, 10)).toBe(5)",
    "})",
    ""
  ].join("\n"),
  "test/twice.test.ts":
    'import { expect, test } from "vitest"\nimport { twice } from "../src/twice.ts"\n\ntest("2倍", () => {\n  expect(twice(3)).toBe(6)\n})\n'
}

const setUp = async ({ cwd, git }: GitRepo) => {
  for (const file of copied) {
    await mkdir(join(cwd, file, ".."), { recursive: true })
    await copyFile(join(root, file), join(cwd, file))
  }
  for (const [file, content] of Object.entries(written)) {
    await mkdir(join(cwd, file, ".."), { recursive: true })
    await writeFile(join(cwd, file), content)
  }
  const install = spawnSync("pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"], { cwd, encoding: "utf8" })
  assert.equal(install.status, 0, install.stderr)
  git("add", ".")
  git("commit", "-qm", "base")
  git("branch", "-M", "main")
}

const judge = (cwd: string) => {
  const result = spawnSync("bash", ["scripts/mutation-diff.sh", "main"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" }
  })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

const edit = async (cwd: string, file: string, change: (text: string) => string) => {
  await writeFile(join(cwd, file), change(await readFile(join(cwd, file), "utf8")))
}

test("SPEC-EXT-005 一時のリポジトリで、テストを消すと判定が失敗し、変えなければ通り、テストや対象を集める範囲を狭めても失敗する", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd, git } = repo
    await setUp(repo)

    git("switch", "-qc", "unchanged")
    const unchanged = judge(cwd)
    assert.equal(unchanged.status, 0, unchanged.output)
    assert.match(unchanged.output, /テストが弱くなった箇所: 0件/)

    git("switch", "-qc", "removed", "main")
    await edit(cwd, "test/clamp.test.ts", (text) => text.replace(/test\("上限"[^]*?\n\}\)\n/, ""))
    git("commit", "-qam", "remove a test")
    const removed = judge(cwd)
    assert.equal(removed.status, 1, removed.output)
    assert.match(removed.output, /::error file=src\/clamp\.ts,line=1,title=テストが弱くなった::/)

    git("switch", "-qc", "narrowed-tests", "main")
    await edit(cwd, "vitest.mutation.config.ts", (text) => text.replace("test/**/*.test.ts", "test/twice.test.ts"))
    git("commit", "-qam", "narrow the tests")
    const narrowedTests = judge(cwd)
    assert.equal(narrowedTests.status, 1, narrowedTests.output)
    assert.match(narrowedTests.output, /::error file=test\/clamp\.test\.ts,title=テストファイルを集めなくなった::/)
    assert.match(narrowedTests.output, /::warning file=vitest\.mutation\.config\.ts,title=テストの設定か準備のファイルが変わった::/)

    git("switch", "-qc", "narrowed-sources", "main")
    await edit(cwd, "mutator.config.json", (text) => text.replace("src/**/*.ts", "src/twice.ts"))
    await rm(join(cwd, "test/clamp.test.ts"))
    git("commit", "-qam", "narrow the sources")
    const narrowedSources = judge(cwd)
    assert.equal(narrowedSources.status, 1, narrowedSources.output)
    assert.match(narrowedSources.output, /::error file=src\/clamp\.ts,title=ミューテーションテストの対象から外れた::/)

    git("switch", "-qc", "renamed", "main")
    git("mv", "test/clamp.test.ts", "test/limits.test.ts")
    git("commit", "-qm", "rename a test")
    const renamed = judge(cwd)
    assert.equal(renamed.status, 0, renamed.output)
  }))
