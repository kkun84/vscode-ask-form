import type { Bridge } from "./bridge.ts"

export const watchStatus = (bridge: Bridge, formKey: string, onCancelled: () => void): (() => void) => {
  let stopped = false
  let timer: number | undefined
  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
  }
  const poll = async () => {
    const result = await bridge.callTool("form_status", { formKey }).catch(() => null)
    if (stopped) {
      return
    }
    const status = result?.isError === true ? undefined : result?.structuredContent?.["status"]
    if (status === "cancelled") {
      stop()
      onCancelled()
    } else {
      timer = window.setTimeout(() => void poll(), 1000)
    }
  }
  void poll()
  return stop
}
