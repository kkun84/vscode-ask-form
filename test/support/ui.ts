import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { readFile } from "node:fs/promises"
import { build } from "esbuild"
import type { Frame, Page } from "@playwright/test"
import type { HostContext } from "../../src/core/appHost.ts"

export interface PageOptions {
  readonly args: Readonly<Record<string, unknown>>
  readonly context?: Partial<HostContext>
  readonly expireOnAnswer?: boolean
  readonly failResend?: boolean
  readonly holdResend?: boolean
  readonly restore?: Readonly<Record<string, unknown>>
}

let hostScript: Promise<string> | undefined

const bundleHost = (): Promise<string> => {
  hostScript ??= build({
    entryPoints: [new URL("./host-page.ts", import.meta.url).pathname],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false
  }).then((result) => result.outputFiles[0]?.text ?? "")
  return hostScript
}

const formHtml = (): Promise<string> => readFile(new URL("../../dist/form.html", import.meta.url), "utf8")

export interface HarnessServer {
  readonly url: string
  readonly close: () => Promise<void>
}

export const startServer = async (): Promise<HarnessServer> => {
  const [script, html] = await Promise.all([bundleHost(), formHtml()])
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/form.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html)
      return
    }
    if (url.pathname === "/host.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }).end(script)
      return
    }
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;}iframe{width:100%;height:1400px;border:0}</style></head><body><script src="/host.js"></script></body></html>'
      )
  })
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
  }
}

const backgrounds = {
  dark: "#1f1f1f",
  light: "#ffffff"
} as const

export const openForm = async (page: Page, server: HarnessServer, options: PageOptions): Promise<Frame> => {
  const context: HostContext = { theme: "dark", locale: "ja", ...options.context }
  await page.addInitScript(
    (setup) => {
      ;(window as unknown as { harnessSetup: unknown }).harnessSetup = setup
    },
    {
      args: options.args,
      context,
      expireOnAnswer: options.expireOnAnswer ?? false,
      failResend: options.failResend ?? false,
      holdResend: options.holdResend ?? false,
      restore: options.restore,
      background: backgrounds[context.theme]
    }
  )
  await page.goto(server.url)
  const frame = page.frameLocator("#form")
  await frame.locator("form, .summary, .closed").first().waitFor()
  const handle = page.frame({ url: /form\.html$/ })
  if (handle === null) {
    throw new Error("form frame not found")
  }
  return handle
}

export const recorded = <T>(page: Page, key: "outcomes" | "resends" | "messages"): Promise<ReadonlyArray<T>> =>
  page.evaluate((name) => (window as unknown as { harness: Record<string, unknown> }).harness[name], key) as Promise<ReadonlyArray<T>>
