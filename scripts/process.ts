import childProcess, { type ChildProcess } from "node:child_process"

const signalTree = (child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void => {
  if (child.pid === undefined) {
    return
  }
  if (process.platform === "win32") {
    childProcess.execFile(
      "taskkill",
      ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
      { timeout: 1000 },
      (error) => {
        if (error !== null) {
          child.kill(signal)
        }
      }
    )
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error
    }
  }
}

export const runCommand = (program: string, args: ReadonlyArray<string>, limitMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = childProcess.spawn(program, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      detached: process.platform !== "win32"
    })
    let stopped = false
    let forced = false
    let exitCode: number | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(escalation)
      process.off("SIGTERM", stop)
      process.off("SIGINT", stop)
    }
    const finish = () => {
      if (exitCode === undefined || (stopped && !forced)) {
        return
      }
      cleanup()
      resolve(stopped ? 1 : exitCode)
    }
    const fail = (error: unknown) => {
      cleanup()
      reject(error)
    }
    const signal = (value: "SIGTERM" | "SIGKILL") => {
      try {
        signalTree(child, value)
      } catch (error) {
        fail(error)
      }
    }
    const stop = () => {
      if (stopped) {
        return
      }
      stopped = true
      escalation = setTimeout(() => {
        signal("SIGKILL")
        forced = true
        finish()
      }, 1000)
      signal("SIGTERM")
    }
    const timer = setTimeout(stop, limitMs)
    process.on("SIGTERM", stop)
    process.on("SIGINT", stop)
    child.once("error", fail)
    child.once("exit", (code) => {
      exitCode = code ?? 1
      clearTimeout(timer)
      finish()
    })
  })
