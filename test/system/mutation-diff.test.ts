import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  "scripts/mutation-original.ts",
  "scripts/mutation-recheck.ts",
  "scripts/mutation-report.ts",
  "scripts/mutation-rerun.ts",
  "scripts/mutation-run.ts",
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
  "src/names.ts": "const pattern = /^[a-z]+$/\n\nexport const valid = (name: string): boolean => pattern.test(name)\n",
  "src/check.ts": 'import { valid } from "./names.ts"\n\nexport const check = (name: string): string => (valid(name) ? "ok" : "ng")\n',
  "test/check.test.ts": [
    'import { expect, test } from "vitest"',
    'import { check } from "../src/check.ts"',
    'import { expectRejected } from "./support/expect.ts"',
    "",
    'test("小文字だけを受け付ける", () => {',
    '  expect(check("abc")).toBe("ok")',
    '  expect(check("ab1")).toBe("ng")',
    '  expectRejected("1ab")',
    "})",
    ""
  ].join("\n"),
  "test/support/expect.ts": [
    'import { expect } from "vitest"',
    'import { check } from "../../src/check.ts"',
    "",
    "export const expectRejected = (name: string) => {",
    '  expect(check(name)).toBe("ng")',
    "}",
    ""
  ].join("\n"),
  "README.md": "# sample\n",
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

const judge = (cwd: string, ...args: ReadonlyArray<string>) => {
  const result = spawnSync("bash", ["scripts/mutation-diff.sh", ...(args.length === 0 ? ["main"] : args)], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" }
  })
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
}

const edit = async (cwd: string, file: string, change: (text: string) => string) => {
  await writeFile(join(cwd, file), change(await readFile(join(cwd, file), "utf8")))
}

const branch = async (repo: GitRepo, name: string, change: () => void | Promise<void>) => {
  repo.git("switch", "-qc", name, "main")
  await change()
  repo.git("add", "-A")
  repo.git("commit", "-q", "--allow-empty", "-m", name)
  return judge(repo.cwd)
}

const passes = (result: ReturnType<typeof judge>) => assert.equal(result.status, 0, result.output)

const fails = (result: ReturnType<typeof judge>, pattern: RegExp) => {
  assert.equal(result.status, 1, result.output)
  assert.match(result.output, pattern)
}

test("SPEC-EXT-005 一時のリポジトリで、テストを消すか弱めると判定が失敗し、変えないか関係の無い変更なら通る", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd } = repo
    await setUp(repo)
    const unchanged = await branch(repo, "unchanged", () => {})
    passes(unchanged)
    assert.match(unchanged.output, /テストが弱くなった箇所: 0件/)
    passes(await branch(repo, "unrelated", () => edit(cwd, "README.md", (text) => `${text}\nmore\n`)))
    passes(
      await branch(repo, "added", () =>
        edit(cwd, "test/twice.test.ts", (text) => `${text}\ntest("0の2倍", () => {\n  expect(twice(0)).toBe(0)\n})\n`)
      )
    )
    passes(
      await branch(repo, "renamed", () => {
        repo.git("mv", "test/clamp.test.ts", "test/limits.test.ts")
      })
    )
    fails(
      await branch(repo, "removed", () => edit(cwd, "test/clamp.test.ts", (text) => text.replace(/test\("上限"[^]*?\n\}\)\n/, ""))),
      /::error file=src\/clamp\.ts,line=1,title=テストが弱くなった::/
    )
    fails(
      await branch(repo, "unselected", () =>
        edit(cwd, "test/check.test.ts", (text) =>
          text.replace('\n  expect(check("ab1")).toBe("ng")', "").replace('\n  expectRejected("1ab")', "")
        )
      ),
      /::error file=src\/names\.ts,line=1,title=テストが弱くなった::.*別に実行して確かめました/
    )
    fails(
      await branch(repo, "helper", () => edit(cwd, "test/support/expect.ts", (text) => text.replace('toBe("ng")', "toBeDefined()"))),
      /::error file=src\/names\.ts,line=1,title=テストが弱くなった::.*別に実行して確かめました/
    )
  }))

const excluding = (text: string) => text.replace('"runner"', '"excludedMutators":["ConditionalExpression","EqualityOperator"],"runner"')

test("SPEC-EXT-005 一時のリポジトリで、テストを消して、消したテストが検出していたミュータントを設定で外すと失敗し、設定を変えるだけなら通る", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd } = repo
    await setUp(repo)
    fails(
      await branch(repo, "excluded", async () => {
        await edit(cwd, "test/clamp.test.ts", (text) => text.replace(/test\("上限"[^]*?\n\}\)\n/, ""))
        await edit(cwd, "mutator.config.json", excluding)
      }),
      /::error file=src\/clamp\.ts,line=1,title=テストが弱くなった::ミュータント\w+\(\w+で[^)]*に置き換え\)は、分岐点のmutatorの設定では「test\/clamp\.test\.ts#上限」が検出していましたが、今の設定では作られません。/
    )
    const settingOnly = await branch(repo, "excluded-only", () => edit(cwd, "mutator.config.json", excluding))
    passes(settingOnly)
    assert.match(settingOnly.output, /::warning file=mutator\.config\.json,title=ミューテーションテストの設定が変わった::/)
  }))

test("SPEC-EXT-005 一時のリポジトリで、テストや対象を集める範囲を狭める、実行を打ち切る、結果をgitで追跡する変更は失敗する", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd } = repo
    await setUp(repo)
    const narrowedTests = await branch(repo, "narrowed-tests", () =>
      edit(cwd, "vitest.mutation.config.ts", (text) => text.replace("test/**/*.test.ts", "test/twice.test.ts"))
    )
    fails(narrowedTests, /::error file=test\/clamp\.test\.ts,title=テストファイルを集めなくなった::/)
    assert.match(narrowedTests.output, /::warning file=vitest\.mutation\.config\.ts,title=テストの設定か準備のファイルが変わった::/)
    fails(
      await branch(repo, "narrowed-sources", async () => {
        await edit(cwd, "mutator.config.json", (text) => text.replace("src/**/*.ts", "src/twice.ts"))
        await rm(join(cwd, "test/clamp.test.ts"))
      }),
      /::error file=src\/clamp\.ts,title=ミューテーションテストの対象から外れた::/
    )
    fails(
      await branch(repo, "time-budget", () =>
        edit(cwd, "mutator.config.json", (text) => text.replace('"runner"', '"timeBudget":0,"runner"'))
      ),
      /::error title=ミューテーションテストの実行を打ち切る設定がある::/
    )
    fails(
      await branch(repo, "per-line", async () => {
        await edit(cwd, "mutator.config.json", (text) => text.replace('"runner"', '"mutantsPerLine":1,"runner"'))
        await edit(cwd, "src/clamp.ts", (text) => text.replace("value > max ? max", "max < value ? max"))
      }),
      /::error title=範囲内のミュータントが実行されなかった::差分の実行で、mutatorが範囲内のミュータントを実行せずに残しました\(not run: \d+ sampled out/
    )
    fails(
      await branch(repo, "tracked", async () => {
        await mkdir(join(cwd, ".mutator-base"), { recursive: true })
        await writeFile(join(cwd, ".mutator-base/x.json"), "{}\n")
        repo.git("add", "-f", ".mutator-base/x.json")
      }),
      /::error title=ミューテーションテストの結果がgitで追跡されている::/
    )
  }))

test("SPEC-EXT-005 一時のリポジトリで、mainに入った弱まりを関係の無い変更の判定に持ち越さない", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd, git } = repo
    await setUp(repo)
    passes(await branch(repo, "before", () => {}))
    git("switch", "-q", "main")
    await edit(cwd, "test/clamp.test.ts", (text) => text.replace(/test\("上限"[^]*?\n\}\)\n/, ""))
    git("commit", "-qam", "weaken on main")
    passes(await branch(repo, "after", () => edit(cwd, "README.md", (text) => `${text}\nafter\n`)))
  }))

const scriptOnly = async ({ cwd, git }: GitRepo) => {
  await writeFile(join(cwd, "a.txt"), "a\n")
  git("add", ".")
  git("commit", "-qm", "a")
  git("branch", "-M", "main")
  await mkdir(join(cwd, "scripts"))
  await copyFile(join(root, "scripts/mutation-diff.sh"), join(cwd, "scripts/mutation-diff.sh"))
}

test("SPEC-EXT-005 知らないオプションと、基準のrefが無いことを扱う", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd } = repo
    await scriptOnly(repo)
    assert.equal(judge(cwd, "--fast", "main").status, 2)
    assert.equal(judge(cwd, "--skip-without-base").status, 2)
    fails(judge(cwd, "origin/none"), /::error title=基準のrefが無い::/)
    const skipped = judge(cwd, "--skip-without-base", "origin/none")
    passes(skipped)
    assert.match(skipped.output, /skipped because origin\/none does not exist/)
  }))

test("SPEC-EXT-005 同じ作業ツリーで動いている判定があれば失敗し、強制終了で残った一時のworktreeは次の判定が消す", () =>
  withGitRepo("mutation-diff-", async (repo) => {
    const { cwd, git } = repo
    await scriptOnly(repo)
    const lock = join(cwd, ".git/mutation-diff.lock")
    const holder = spawn(
      "perl",
      ["-MFcntl=:flock", "-e", 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\\n"; sleep 60', lock],
      { stdio: ["ignore", "pipe", "inherit"] }
    )
    try {
      await once(holder.stdout, "data")
      await writeFile(lock, `${holder.pid}\n`)
      fails(judge(cwd), new RegExp(`::error title=mutation:diffが動いている::.*プロセス${holder.pid}`))
    } finally {
      const exited = once(holder, "exit")
      holder.kill("SIGKILL")
      await exited
    }
    const left = await mkdtemp(join(process.env["TMPDIR"] ?? "/tmp", "mutation-base."))
    git("worktree", "add", "--detach", "--quiet", join(left, "tree"), "main")
    await writeFile(lock, `${spawnSync("true").pid}\n${left}\n`)
    assert.doesNotMatch(judge(cwd).output, /mutation:diffが動いている/)
    assert.equal(await readFile(lock, "utf8"), "")
    assert.equal(existsSync(left), false)
    assert.doesNotMatch(git("worktree", "list"), /mutation-base\./)
  }))
