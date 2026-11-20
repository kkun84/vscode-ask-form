import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface GitRepo {
  readonly cwd: string
  readonly git: (...args: ReadonlyArray<string>) => string
  readonly run: (entry: string, ...args: ReadonlyArray<string>) => SpawnSyncReturns<string>
}

export const withGitRepo = async (prefix: string, body: (repo: GitRepo) => Promise<void>): Promise<void> => {
  const cwd = await mkdtemp(join(tmpdir(), prefix))
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" })
  const run = (entry: string, ...args: ReadonlyArray<string>) => spawnSync(process.execPath, [entry, ...args], { cwd, encoding: "utf8" })
  try {
    git("init", "-q")
    await body({ cwd, git, run })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
