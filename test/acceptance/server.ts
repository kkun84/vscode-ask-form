import { execFileSync, spawn } from "node:child_process"
import { access, mkdir, readFile, rename, rm } from "node:fs/promises"
import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { dirname, join } from "node:path"
import { sleep, until } from "./frames.ts"
import { serverCache } from "./paths.ts"

export const desktopCommit = async (electron: string): Promise<string> => {
  const candidates = [join(dirname(electron), "resources/app/product.json"), join(dirname(electron), "../Resources/app/product.json")]
  for (const candidate of candidates) {
    const product = await readFile(candidate, "utf8").catch(() => null)
    if (product !== null) {
      return (JSON.parse(product) as { readonly commit: string }).commit
    }
  }
  throw new Error(`product.json not found next to ${electron}`)
}

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })

export const ensureServer = async (commit: string): Promise<string> => {
  const directory = join(serverCache, commit)
  const ready = await access(join(directory, "bin/code-server")).then(
    () => true,
    () => false
  )
  if (ready) {
    return directory
  }
  const os = process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "x64"
  const staging = `${directory}.partial`
  const archive = `${directory}.tar.gz`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--output",
      archive,
      `https://update.code.visualstudio.com/commit:${commit}/server-${os}-${arch}-web/stable`
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  )
  execFileSync("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"])
  await rm(archive, { force: true })
  await rename(staging, directory)
  return directory
}

export interface ServerOptions {
  readonly directory: string
  readonly profile: string
  readonly extensions: ReadonlyArray<string>
  readonly env: Readonly<Record<string, string>>
}

export interface RunningServer {
  readonly origin: string
  readonly commit: string
  readonly close: () => Promise<void>
}

export const startServer = async (commit: string, options: ServerOptions): Promise<RunningServer> => {
  const binary = join(options.directory, "bin/code-server")
  const data = join(options.profile, "server")
  const extensions = join(options.profile, "extensions")
  for (const extension of options.extensions) {
    execFileSync(binary, ["--install-extension", extension, "--extensions-dir", extensions, "--server-data-dir", data], {
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 120_000
    })
  }
  const port = await freePort()
  const child = spawn(
    binary,
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--without-connection-token",
      "--accept-server-license-terms",
      "--server-data-dir",
      data,
      "--extensions-dir",
      extensions
    ],
    { env: { ...process.env, ...options.env }, stdio: "ignore" }
  )
  const origin = `http://127.0.0.1:${port}`
  await until(
    () =>
      fetch(`${origin}/version`).then(
        (response) => (response.ok ? true : null),
        () => null
      ),
    "the VS Code server answers",
    60_000
  )
  return {
    origin,
    commit,
    close: async () => {
      child.kill()
      await sleep(500)
    }
  }
}
