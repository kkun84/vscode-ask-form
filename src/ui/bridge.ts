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

export type MessageContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "resource_link"; readonly uri: string; readonly name: string; readonly mimeType: string }

export interface Bridge {
  readonly callTool: (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>
  readonly placeMessage: (content: ReadonlyArray<MessageContent>) => Promise<boolean>
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

const originOf = (target: Window): string | undefined => {
  try {
    return target.location.origin
  } catch {
    return undefined
  }
}

const channelTo = (target: Window) => {
  let origin = originOf(target)
  return {
    post: (message: Record<string, unknown>) =>
      target.postMessage({ jsonrpc: "2.0", ...message }, origin === "null" ? "*" : (origin ?? "*")),
    listen: (receive: (message: Message) => void) =>
      window.addEventListener("message", (event: MessageEvent<Message>) => {
        if (event.source !== target || (origin !== undefined && event.origin !== origin)) {
          return
        }
        const message = event.data
        if (message === null || typeof message !== "object" || message.jsonrpc !== "2.0") {
          return
        }
        origin ??= event.origin
        receive(message)
      })
  }
}

export const connect = (handlers: BridgeHandlers, target: Window = window.parent): Promise<Bridge> => {
  let nextId = 1
  const pending = new Map<number | string, Pending>()
  const { post, listen } = channelTo(target)

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ id, method, params })
    })

  const respond = (id: number | string, result: unknown) => post({ id, result })

  const settle = (message: Message & { readonly id: number | string }) => {
    const waiter = pending.get(message.id)
    if (waiter === undefined) {
      return
    }
    pending.delete(message.id)
    if (message.error === undefined) {
      waiter.resolve(message.result)
    } else {
      waiter.reject(new Error(message.error.message ?? "request failed"))
    }
  }

  const notifications: Readonly<Record<string, (params: Record<string, unknown>) => void>> = {
    "ui/notifications/tool-input": (params) => handlers.onToolInput((params["arguments"] ?? {}) as Readonly<Record<string, unknown>>),
    "ui/notifications/tool-result": (params) => handlers.onToolResult(params as ToolResult),
    "ui/notifications/tool-cancelled": () => handlers.onToolCancelled(),
    "ui/notifications/host-context-changed": (params) => handlers.onHostContext(params as HostContext)
  }

  const acknowledged: ReadonlySet<string> = new Set(["ui/resource-teardown", "ping"])

  const onMessage = (message: Message) => {
    const { id, method } = message
    if (method === undefined) {
      if (id !== undefined) {
        settle({ ...message, id })
      }
      return
    }
    notifications[method]?.(message.params ?? {})
    if (acknowledged.has(method) && id !== undefined) {
      respond(id, {})
    }
  }

  listen(onMessage)

  return request("ui/initialize", {
    appInfo: { name: "ask-form", version: "1" },
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
      placeMessage: (content) =>
        request("ui/message", { role: "user", content }).then(
          (placed) => (placed as { readonly isError?: boolean } | undefined)?.isError !== true,
          () => false
        ),
      notifySize: (height) => post({ method: "ui/notifications/size-changed", params: { height } })
    }
  })
}
