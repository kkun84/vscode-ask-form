import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

type Listener<T> = (value: T) => void

class Emitter<T> {
  private listeners: Array<Listener<T>> = []

  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener)
    return { dispose: () => (this.listeners = this.listeners.filter((item) => item !== listener)) }
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners = []
  }
}

interface FakeUri {
  readonly path: string
  readonly toString: () => string
}

const uri = (path: string): FakeUri => ({ path, toString: () => path })

export interface FakePanel {
  readonly title: string
  readonly html: () => string
  readonly sent: Array<Record<string, unknown>>
  readonly receive: (message: unknown) => void
  readonly dispose: () => void
}

export interface StatusItem {
  visible: boolean
  text: string
}

export interface Recorder {
  readonly commands: Array<{ readonly command: string; readonly args: ReadonlyArray<unknown> }>
  readonly files: Map<string, string>
  readonly status: Array<StatusItem>
  readonly tools: Map<string, { readonly invoke: (options: { readonly input: unknown }, token: FakeToken) => Promise<unknown> }>
  readonly providers: Map<string, { readonly provideMcpServerDefinitions: () => ReadonlyArray<McpHttpServerDefinition> }>
  readonly panels: Array<FakePanel>
}

export interface FakeToken {
  readonly isCancellationRequested: boolean
  readonly onCancellationRequested: (listener: Listener<void>) => { readonly dispose: () => void }
}

export const cancellation = (): { readonly token: FakeToken; readonly cancel: () => void } => {
  const emitter = new Emitter<void>()
  let cancelled = false
  return {
    token: {
      get isCancellationRequested() {
        return cancelled
      },
      onCancellationRequested: emitter.event
    },
    cancel: () => {
      cancelled = true
      emitter.fire()
    }
  }
}

class McpHttpServerDefinition {
  readonly label: string
  readonly uri: FakeUri
  readonly headers: Record<string, string>
  readonly version: string

  constructor(label: string, target: FakeUri, headers: Record<string, string>, version: string) {
    this.label = label
    this.uri = target
    this.headers = headers
    this.version = version
  }
}

class LanguageModelTextPart {
  readonly value: string

  constructor(value: string) {
    this.value = value
  }
}

class LanguageModelToolResult {
  readonly content: ReadonlyArray<LanguageModelTextPart>

  constructor(content: ReadonlyArray<LanguageModelTextPart>) {
    this.content = content
  }
}

class ThemeColor {
  readonly id: string

  constructor(id: string) {
    this.id = id
  }
}

const createPanel = (title: string): FakePanel & { readonly api: unknown } => {
  const received = new Emitter<unknown>()
  const disposed = new Emitter<void>()
  const sent: Array<Record<string, unknown>> = []
  let html = ""
  const webview = {
    get html() {
      return html
    },
    set html(value: string) {
      html = value
    },
    postMessage: (message: Record<string, unknown>) => {
      sent.push(message)
      return Promise.resolve(true)
    },
    onDidReceiveMessage: received.event
  }
  return {
    title,
    html: () => html,
    sent,
    receive: (message) => received.fire(message),
    dispose: () => disposed.fire(),
    api: { webview, onDidDispose: disposed.event, dispose: () => disposed.fire() }
  }
}

export const createVscode = (language = "ja"): { readonly vscode: unknown; readonly recorder: Recorder } => {
  const recorder: Recorder = { commands: [], files: new Map(), status: [], tools: new Map(), providers: new Map(), panels: [] }
  const vscode = {
    EventEmitter: Emitter,
    McpHttpServerDefinition,
    LanguageModelTextPart,
    LanguageModelToolResult,
    ThemeColor,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Beside: -2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    Uri: {
      parse: (value: string) => uri(value),
      joinPath: (base: FakeUri, ...parts: ReadonlyArray<string>) => uri([base.path, ...parts].join("/"))
    },
    env: { language },
    window: {
      activeColorTheme: { kind: 2 },
      createStatusBarItem: () => {
        const item: StatusItem & Record<string, unknown> = { visible: false, text: "" }
        recorder.status.push(item)
        return Object.assign(item, {
          show: () => (item.visible = true),
          hide: () => (item.visible = false),
          dispose: () => (item.visible = false)
        })
      },
      createWebviewPanel: (_type: string, title: string) => {
        const panel = createPanel(title)
        recorder.panels.push(panel)
        return panel.api
      }
    },
    workspace: {
      fs: {
        createDirectory: () => Promise.resolve(),
        writeFile: (target: FakeUri, content: Uint8Array) => {
          recorder.files.set(target.path, new TextDecoder().decode(content))
          return Promise.resolve()
        }
      }
    },
    commands: {
      executeCommand: (command: string, ...args: ReadonlyArray<unknown>) => {
        recorder.commands.push({ command, args })
        return Promise.resolve()
      }
    },
    lm: {
      registerTool: (name: string, tool: Recorder["tools"] extends Map<string, infer T> ? T : never) => {
        recorder.tools.set(name, tool)
        return { dispose: () => recorder.tools.delete(name) }
      },
      registerMcpServerDefinitionProvider: (id: string, provider: Recorder["providers"] extends Map<string, infer T> ? T : never) => {
        recorder.providers.set(id, provider)
        return { dispose: () => recorder.providers.delete(id) }
      }
    }
  }
  return { vscode, recorder }
}

export interface ExtensionModule {
  readonly activate: (context: unknown) => unknown
}

export const loadBundle = (path: string, vscode: unknown, runtime: "node" | "web"): ExtensionModule => {
  const nodeRequire = createRequire(path)
  const require = (request: string): unknown => {
    if (request === "vscode") {
      return vscode
    }
    if (runtime === "web") {
      throw new Error(`web extension cannot require ${request}`)
    }
    return nodeRequire(request)
  }
  const module = { exports: {} }
  const run = new Function("module", "exports", "require", readFileSync(path, "utf8")) as (m: unknown, e: unknown, r: unknown) => void
  run(module, module.exports, require)
  return module.exports as ExtensionModule
}

export const fakeContext = () => {
  const subscriptions: Array<{ readonly dispose: () => unknown }> = []
  return {
    context: { subscriptions, globalStorageUri: uri("/storage") },
    dispose: () => Promise.all(subscriptions.map((item) => item.dispose()))
  }
}
