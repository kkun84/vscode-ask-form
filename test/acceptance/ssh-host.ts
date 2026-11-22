import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { access, chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { userInfo } from "node:os"
import { join } from "node:path"
import { until } from "./frames.ts"
import { remoteSshCache } from "./paths.ts"
import { freePort } from "./server.ts"

interface SshHost {
  readonly name: string
  readonly config: string
  readonly client: string
  readonly close: () => Promise<void>
}

const remoteSshVersion = "0.129.2026100915"
const remoteSshDigest = "11b085290fea80fb486f67679802b47dc52cb1107bd1f1f91f888b5ae33287d5"

const openssh = (): string => {
  const directory = process.env["ASK_FORM_OPENSSH"]
  if (directory === undefined) {
    throw new Error("ASK_FORM_OPENSSH is not set. Run inside `nix develop .#acceptance`.")
  }
  return directory
}

const ensureRemoteSsh = async (): Promise<string> => {
  const target = join(remoteSshCache, `remote-ssh-${remoteSshVersion}.vsix`)
  const ready = await access(target).then(
    () => true,
    () => false
  )
  if (ready) {
    return target
  }
  await mkdir(remoteSshCache, { recursive: true })
  execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--compressed",
      "--output",
      `${target}.partial`,
      `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/${remoteSshVersion}/vspackage`
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  )
  const digest = createHash("sha256")
    .update(await readFile(`${target}.partial`))
    .digest("hex")
  if (digest !== remoteSshDigest) {
    throw new Error(`Remote - SSH ${remoteSshVersion} has the digest ${digest}, not ${remoteSshDigest}`)
  }
  await copyFile(`${target}.partial`, target)
  await rm(`${target}.partial`, { force: true })
  return target
}

const key = (file: string): void => {
  execFileSync(join(openssh(), "bin/ssh-keygen"), ["-q", "-t", "ed25519", "-N", "", "-f", file])
}

const startSshHost = async (directory: string): Promise<SshHost> => {
  await mkdir(directory, { recursive: true })
  const file = (name: string) => join(directory, name)
  key(file("host_key"))
  key(file("client_key"))
  await writeFile(file("authorized_keys"), await readFile(file("client_key.pub")))
  await chmod(file("authorized_keys"), 0o600)
  const port = await freePort()
  await writeFile(
    file("sshd_config"),
    [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${file("host_key")}`,
      `PidFile ${file("sshd.pid")}`,
      `AuthorizedKeysFile ${file("authorized_keys")}`,
      "StrictModes no",
      "PasswordAuthentication no",
      "PermitRootLogin yes",
      ""
    ].join("\n")
  )
  const name = "ask-form-acceptance"
  await writeFile(
    file("ssh_config"),
    [
      `Host ${name}`,
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      `  User ${userInfo().username}`,
      `  IdentityFile ${file("client_key")}`,
      "  IdentitiesOnly yes",
      "  StrictHostKeyChecking no",
      `  UserKnownHostsFile ${file("known_hosts")}`,
      ""
    ].join("\n")
  )
  let output = ""
  const server = spawn(join(openssh(), "bin/sshd"), ["-D", "-e", "-f", file("sshd_config")], { stdio: ["ignore", "ignore", "pipe"] })
  server.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8")
  })
  const client = join(openssh(), "bin/ssh")
  const connected = (): boolean => {
    try {
      execFileSync(client, ["-F", file("ssh_config"), name, "true"], { stdio: "ignore", timeout: 10_000 })
      return true
    } catch {
      return false
    }
  }
  await until(() => Promise.resolve(connected() ? true : null), "the SSH server accepts a connection", 30_000).catch((error: unknown) => {
    server.kill()
    throw new Error(`${String(error)}\n${output}`)
  })
  return {
    name,
    config: file("ssh_config"),
    client,
    close: () =>
      new Promise((resolve) => {
        server.once("exit", () => resolve())
        server.kill()
      })
  }
}

interface RemoteWindow {
  readonly args: ReadonlyArray<string>
  readonly settings: Readonly<Record<string, unknown>>
  readonly extensions: ReadonlyArray<string>
  readonly close: () => Promise<void>
}

export const sshWindow = async (profile: string): Promise<RemoteWindow> => {
  const host = await startSshHost(join(profile, "ssh"))
  const folder = join(profile, "remote", "workspace")
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "README.md"), "acceptance\n")
  return {
    args: ["--folder-uri", `vscode-remote://ssh-remote+${host.name}${folder}`],
    settings: {
      "remote.SSH.configFile": host.config,
      "remote.SSH.path": host.client,
      "remote.SSH.remotePlatform": { [host.name]: "linux" },
      "remote.SSH.serverInstallPath": { [host.name]: join(profile, "remote") }
    },
    extensions: [await ensureRemoteSsh()],
    close: host.close
  }
}
