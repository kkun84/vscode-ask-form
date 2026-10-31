import { spawnSync } from "node:child_process"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CDPSession, ElectronApplication, Frame, Locator, Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeLlm } from "./fake-llm.ts"
import { formFrame, sleep, until } from "./frames.ts"
import { cleanUp, closeApp, fitWindow, launchVscode, type VscodePaths } from "./vscode.ts"

export interface MediaPaths extends VscodePaths {
  readonly cli: string
  readonly images: string
  readonly work: string
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Capture {
  readonly video: string
  readonly size: { readonly width: number; readonly height: number }
  readonly marks: Readonly<Record<string, number>>
  readonly regions: Readonly<Record<string, Rect>>
}

const query = "来月の技術交流会の条件を決めたいです。フォームで聞いてください。"
const trigger = "フォームで聞いて"
const reply =
  "ありがとうございます。参加者150人、参加費¥2,000、ライブ配信ありで進めます。収支は¥130,000の黒字見込みです。会場と配信の手配を始めます。"
const followUp = "参加費¥2,500で計算し直しました。収支は¥205,000の黒字見込みです。案内文の参加費も更新します。"
const screenSize = { width: 1600, height: 1036 }
const titleBar = 36
let view: Rect = { x: 0, y: titleBar, width: screenSize.width, height: screenSize.height - titleBar }

const languagePack =
  "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/MS-CEINTL/vsextensions/vscode-language-pack-ja/latest/vspackage"

const run = (command: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
}

const installLanguagePack = (cli: string, profile: string): void => {
  const vsix = join(profile, "language-pack-ja.vsix")
  run("curl", ["-sSfL", "--compressed", "-o", vsix, languagePack])
  run(cli, [
    "--no-sandbox",
    "--user-data-dir",
    join(profile, "user"),
    "--extensions-dir",
    join(profile, "extensions"),
    "--install-extension",
    vsix
  ])
}

const pointerStyle = ".notifications-toasts, .chat-input-notification-container { display: none !important; }"
const density = 2

const pointerPath = "M4 2 L4 20 L9 15 L12.5 22 L15.5 20.6 L12 13.8 L19 13.8 Z"

class Recorder {
  private readonly frames: Array<{ readonly file: string; readonly at: number }> = []
  readonly marks: Record<string, number> = {}
  private readonly page: Page
  private readonly dir: string
  private session: CDPSession | undefined
  private startedAt = 0
  private writes: Array<Promise<void>> = []

  constructor(page: Page, dir: string) {
    this.page = page
    this.dir = dir
  }

  async start(): Promise<void> {
    this.startedAt = Date.now() / 1000
    const session = await this.page.context().newCDPSession(this.page)
    this.session = session
    session.on("Page.screencastFrame", (event) => {
      const file = join(this.dir, `${String(this.frames.length).padStart(5, "0")}.jpg`)
      this.frames.push({ file, at: this.frames.length === 0 ? 0 : Date.now() / 1000 - this.startedAt })
      this.writes.push(writeFile(file, Buffer.from(event.data, "base64")))
      void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => null)
    })
    await session.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 })
  }

  mark(name: string): void {
    this.marks[name] = Date.now() / 1000 - this.startedAt
  }

  async stop(output: string): Promise<void> {
    await this.session?.send("Page.stopScreencast")
    await Promise.all(this.writes)
    const end = Date.now() / 1000 - this.startedAt
    const lines = ["ffconcat version 1.0"]
    this.frames.forEach((frame, index) => {
      const next = this.frames[index + 1]?.at ?? end
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`)
    })
    const last = this.frames.at(-1)
    if (last !== undefined) {
      lines.push(`file '${last.file}'`)
    }
    const list = join(this.dir, "frames.txt")
    await writeFile(list, `${lines.join("\n")}\n`)
    run("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      `scale=${view.width * density}:${(view.height + view.y) * density}:flags=lanczos,crop=${view.width * density}:${view.height * density}:${view.x * density}:${view.y * density},fps=30,format=yuv420p`,
      "-c:v",
      "libx264",
      "-crf",
      "12",
      "-preset",
      "veryfast",
      output
    ])
  }
}

const center = async (target: Locator): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await target.boundingBox()
  if (box === null) {
    throw new Error("the target is not visible")
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const pointTo = async (page: Page, target: Locator): Promise<void> => {
  await page.evaluate(
    (point) => {
      const pointer = document.querySelector<HTMLElement>("#ask-form-pointer")
      if (pointer !== null) {
        pointer.style.transform = `translate(${point.x - 4}px, ${point.y - 2}px)`
      }
    },
    await center(target)
  )
  await sleep(800)
}

const ripple = (page: Page, target: Locator) =>
  center(target).then((point) =>
    page.evaluate(({ x, y }) => {
      const ring = document.createElement("div")
      ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;border:3px solid #4fc3ff;transition:transform 600ms ease-out,opacity 600ms ease-out;transform:scale(.3);opacity:1`
      requestAnimationFrame(() => {
        ring.style.transform = "scale(1.4)"
        ring.style.opacity = "0"
      })
      document.body.append(ring)
      setTimeout(() => ring.remove(), 800)
    }, point)
  )

const clickWithPointer = async (page: Page, target: Locator): Promise<void> => {
  await pointTo(page, target)
  await ripple(page, target)
  await target.click()
}

const installPointer = async (page: Page): Promise<void> => {
  await page.addStyleTag({ content: pointerStyle })
  await page.evaluate((d) => {
    const namespace = "http://www.w3.org/2000/svg"
    const pointer = document.createElement("div")
    pointer.id = "ask-form-pointer"
    const svg = document.createElementNS(namespace, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    const path = document.createElementNS(namespace, "path")
    path.setAttribute("d", d)
    path.setAttribute("fill", "#fff")
    path.setAttribute("stroke", "#111")
    path.setAttribute("stroke-width", "1.4")
    path.setAttribute("stroke-linejoin", "round")
    svg.append(path)
    pointer.append(svg)
    pointer.style.cssText =
      "position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform 700ms cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));transform:translate(1100px,700px)"
    svg.style.cssText = "width:26px;height:26px;pointer-events:none"
    document.body.append(pointer)
  }, pointerPath)
  await page
    .locator(".chat-input-notification-dismiss")
    .first()
    .click({ timeout: 10_000 })
    .catch(() => null)
}

const shoot = (page: Page, images: string, name: string) => page.screenshot({ path: join(images, `${name}.png`), clip: view, scale: "css" })

const typeNumber = async (page: Page, frame: Frame, label: string, value: string): Promise<void> => {
  const input = frame.getByRole("spinbutton", { name: label })
  await clickWithPointer(page, input)
  await input.press("ControlOrMeta+a")
  await input.pressSequentially(value, { delay: 220 })
  await frame.locator("h1").click()
}

const regionOf = async (...targets: ReadonlyArray<Locator>): Promise<Rect> => {
  const boxes = await Promise.all(targets.map((target) => target.boundingBox()))
  const present = boxes.filter((box) => box !== null)
  if (present.length === 0) {
    throw new Error("the region is not visible")
  }
  const left = Math.min(...present.map((box) => box.x))
  const top = Math.min(...present.map((box) => box.y))
  const right = Math.max(...present.map((box) => box.x + box.width))
  const bottom = Math.max(...present.map((box) => box.y + box.height))
  return {
    x: Math.round(left * density),
    y: Math.round((top - titleBar) * density),
    width: Math.round((right - left) * density),
    height: Math.round((bottom - top) * density)
  }
}

const ask = async (page: Page, recorder: Recorder): Promise<Frame> => {
  const input = page.locator(".interactive-input-part .monaco-editor .view-lines").last()
  await sleep(1200)
  await clickWithPointer(page, input)
  recorder.mark("typing")
  for (const character of query) {
    await page.keyboard.insertText(character)
    await sleep(70)
  }
  await sleep(700)
  recorder.mark("send")
  await page.keyboard.press("Enter")
  const frame = await formFrame(page)
  recorder.mark("form")
  return frame
}

const dismissNotice = (page: Page) =>
  page
    .locator(".chat-input-notification-dismiss")
    .first()
    .click({ timeout: 3000 })
    .catch(() => null)

const scenario = async (page: Page, images: string, recorder: Recorder): Promise<Readonly<Record<string, Rect>>> => {
  const frame = await ask(page, recorder)
  await dismissNotice(page)
  await sleep(2500)
  const regions: Record<string, Rect> = {
    chat: await regionOf(page.locator(".interactive-session").first()),
    form: await regionOf(frame.locator("form.card")),
    input: await regionOf(page.locator(".interactive-input-part").last())
  }
  await shoot(page, images, "form")
  recorder.mark("edit")
  await typeNumber(page, frame, "参加者数", "150")
  recorder.mark("edited")
  await sleep(2200)
  await shoot(page, images, "edited")
  recorder.mark("answer")
  await clickWithPointer(page, frame.locator("form.card button.primary"))
  await page
    .locator(".interactive-response", { hasText: reply.slice(0, 12) })
    .last()
    .waitFor({ timeout: 60_000 })
  recorder.mark("answered")
  await sleep(1500)
  regions["answered"] = await regionOf(frame.locator("body"), page.locator(".interactive-response").last())
  await sleep(1500)
  await shoot(page, images, "answered")
  recorder.mark("resend")
  await clickWithPointer(page, frame.getByRole("button", { name: "変更して送り直す" }))
  await sleep(900)
  await typeNumber(page, frame, "参加費", "2500")
  await sleep(1500)
  await clickWithPointer(page, frame.getByRole("button", { name: "変更を送信" }))
  await frame.locator(".summary .notice").waitFor()
  recorder.mark("placed")
  regions["placed"] = await regionOf(frame.locator(".summary .notice"), page.locator(".interactive-input-part").last())
  await sleep(2800)
  await shoot(page, images, "placed")
  recorder.mark("send-resend")
  const send = page
    .locator(".interactive-input-part")
    .last()
    .getByRole("button", { name: /^送信/ })
    .first()
  await clickWithPointer(page, send)
  await page
    .locator(".interactive-response", { hasText: followUp.slice(0, 12) })
    .last()
    .waitFor({ timeout: 60_000 })
  recorder.mark("followed")
  await sleep(3500)
  recorder.mark("end")
  return regions
}

const settings = {
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.secondarySideBar.defaultVisibility": "maximized",
  "window.titleBarStyle": "native",
  "window.menuBarVisibility": "hidden",
  "editor.cursorBlinking": "solid"
}

const even = (value: number) => value - (value % 2)

const measureView = async (page: Page): Promise<Rect> => {
  const actual = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  return { x: 0, y: titleBar, width: even(actual.width), height: even(actual.height - titleBar) }
}

const warmUp = async (paths: MediaPaths, options: Parameters<typeof launchVscode>[1]): Promise<void> => {
  const app = await launchVscode(paths, options)
  try {
    await until(
      () =>
        access(join(options.profile, "user", "languagepacks.json")).then(
          () => true,
          () => null
        ),
      "VS Code registers the Japanese language pack",
      60_000
    )
  } finally {
    await closeApp(app)
  }
}

export const captureMedia = async (paths: MediaPaths): Promise<Capture> => {
  await mkdir(paths.images, { recursive: true })
  const frames = join(paths.work, "frames")
  await rm(frames, { recursive: true, force: true })
  await mkdir(frames, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), "ask-form-media-"))
  const llm = await startFakeLlm(trigger, eventSpec, reply, followUp)
  const options = { llm, log: join(profile, "driver.log"), profile, locale: "ja", query, settings, draft: true, scale: density }
  let app: ElectronApplication | undefined
  try {
    installLanguagePack(paths.cli, profile)
    await warmUp(paths, options)
    app = await launchVscode(paths, options)
    const page = await fitWindow(app, screenSize)
    page.context().setDefaultTimeout(30_000)
    await page.locator(".interactive-input-part").first().waitFor({ timeout: 60_000 })
    await sleep(3000)
    view = await measureView(page)
    await installPointer(page)
    const recorder = new Recorder(page, frames)
    await recorder.start()
    const regions = await scenario(page, paths.images, recorder)
    const video = join(paths.work, "capture.mp4")
    await recorder.stop(video)
    const capture: Capture = { video, size: { width: view.width * density, height: view.height * density }, marks: recorder.marks, regions }
    await writeFile(join(paths.work, "capture.json"), JSON.stringify(capture, undefined, 2))
    return capture
  } finally {
    await cleanUp(app, llm, profile)
  }
}

export const toGif = (capture: Capture, gif: string): void => {
  const chat = capture.regions["chat"] ?? { x: 0, y: 0, ...capture.size }
  const start = (capture.marks["typing"] ?? 0) - 0.3
  const end = capture.marks["end"] ?? 60
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    start.toFixed(2),
    "-to",
    end.toFixed(2),
    "-i",
    capture.video,
    "-vf",
    `crop=${chat.width}:${chat.height}:${chat.x}:${chat.y},fps=12,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`,
    gif
  ])
}
