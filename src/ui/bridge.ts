export interface HostContext {
  readonly theme?: "light" | "dark"
  readonly locale?: string
  readonly styles?: { readonly variables?: Readonly<Record<string, string>> }
}

export interface ToolResult {
  readonly isError?: boolean
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>
  readonly structuredContent?: Readonly<Record<string, unknown>>
}

export interface BridgeHandlers {
  readonly onToolInput: (args: Readonly<Record<string, unknown>>) => void
  readonly onToolResult: (result: ToolResult) => void
  readonly onToolCancelled: () => void
  readonly onHostContext: (context: HostContext) => void
}

export interface Bridge {
  readonly callTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>
  readonly notifySize: (height: number) => void
}

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

type Message = {
  readonly jsonrpc?: string
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

const protocolVersion = "2026-01-26"

export const connect = (handlers: BridgeHandlers, target: Window = window.parent): Promise<Bridge> => {
  let nextId = 1
  const pending = new Map<number | string, Pending>()
  const post = (message: Record<string, unknown>) => target.postMessage({ jsonrpc: "2.0", ...message }, "*")

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ id, method, params })
    })

  const respond = (id: number | string, result: unknown) => post({ id, result })

  const onMessage = (event: MessageEvent<Message>) => {
    const message = event.data
    if (message === null || typeof message !== "object") {
      return
    }
    if (message.method === undefined && message.id !== undefined) {
      const waiter = pending.get(message.id)
      if (waiter !== undefined) {
        pending.delete(message.id)
        if (message.error === undefined) {
          waiter.resolve(message.result)
        } else {
          waiter.reject(new Error(message.error.message ?? "request failed"))
        }
      }
      return
    }
    const params = message.params ?? {}
    switch (message.method) {
      case "ui/notifications/tool-input":
        handlers.onToolInput((params["arguments"] ?? {}) as Readonly<Record<string, unknown>>)
        break
      case "ui/notifications/tool-result":
        handlers.onToolResult(params as ToolResult)
        break
      case "ui/notifications/tool-cancelled":
        handlers.onToolCancelled()
        break
      case "ui/notifications/host-context-changed":
        handlers.onHostContext(params as HostContext)
        break
      case "ui/resource-teardown":
        if (message.id !== undefined) {
          respond(message.id, {})
        }
        break
      case "ping":
        if (message.id !== undefined) {
          respond(message.id, {})
        }
        break
      default:
        break
    }
  }

  window.addEventListener("message", onMessage)

  return request("ui/initialize", {
    appInfo: { name: "copilot-forms", version: "1" },
    appCapabilities: {},
    protocolVersion
  }).then((result) => {
    const initialized = (result ?? {}) as { readonly hostContext?: HostContext }
    if (initialized.hostContext !== undefined) {
      handlers.onHostContext(initialized.hostContext)
    }
    post({ method: "ui/notifications/initialized", params: {} })
    return {
      callTool: (name, args) => request("tools/call", { name, arguments: args }) as Promise<ToolResult>,
      notifySize: (height) => post({ method: "ui/notifications/size-changed", params: { height } })
    }
  })
}
