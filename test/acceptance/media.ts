import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ElectronApplication, Frame, Locator, Page } from "@playwright/test"
import { todoSpec } from "../fixtures/todo.ts"
import { startFakeLlm } from "./fake-llm.ts"
import { formFrame, sleep, until } from "./frames.ts"
import { Pointer, Recorder, typeNumber, run } from "./recording.ts"
import { followUp, query, reply } from "./stage-content.ts"
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

const trigger = "フォームで聞いて"
const screenSize = { width: 1600, height: 1036 }
const titleBar = 36
let view: Rect = { x: 0, y: titleBar, width: screenSize.width, height: screenSize.height - titleBar }

const languagePack =
  "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/MS-CEINTL/vsextensions/vscode-language-pack-ja/latest/vspackage"

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

const tidy = async (page: Page, pointer: Pointer): Promise<void> => {
  await page.addStyleTag({ content: pointerStyle })
  await pointer.install({ x: 1100, y: 700 })
  await page
    .locator(".chat-input-notification-dismiss")
    .first()
    .click({ timeout: 10_000 })
    .catch(() => null)
}

const shoot = (page: Page, images: string, name: string) => page.screenshot({ path: join(images, `${name}.png`), clip: view, scale: "css" })

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

const ask = async (page: Page, pointer: Pointer, recorder: Recorder): Promise<Frame> => {
  const input = page.locator(".interactive-input-part .monaco-editor .view-lines").last()
  await page.locator(".interactive-input-part").last().getByText("Fake Model").first().waitFor({ timeout: 60_000 })
  await sleep(1200)
  await pointer.click(input)
  recorder.mark("typing")
  for (const character of query) {
    await page.keyboard.insertText(character)
    recorder.sound("key")
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

const scenario = async (page: Page, pointer: Pointer, images: string, recorder: Recorder): Promise<Readonly<Record<string, Rect>>> => {
  const frame = await ask(page, pointer, recorder)
  await dismissNotice(page)
  await sleep(2500)
  const regions: Record<string, Rect> = {
    chat: await regionOf(page.locator(".interactive-session").first()),
    form: await regionOf(frame.locator("form.card")),
    input: await regionOf(page.locator(".interactive-input-part").last())
  }
  await shoot(page, images, "form")
  recorder.mark("edit")
  await pointer.click(frame.locator("label.option", { hasText: "サーバー" }))
  await pointer.click(frame.getByRole("switch", { name: "ログインが必要" }))
  await sleep(2200)
  recorder.mark("edited")
  await shoot(page, images, "branch")
  recorder.mark("answer")
  await pointer.click(frame.locator("form.card button.primary"))
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
  await pointer.click(frame.getByRole("button", { name: "変更して送り直す" }))
  await sleep(900)
  await typeNumber(pointer, recorder, frame, "1ページの件数", "50")
  await sleep(1500)
  await pointer.click(frame.getByRole("button", { name: "変更を送信" }))
  await frame.locator(".summary .notice").waitFor()
  recorder.mark("placed")
  regions["placed"] = await regionOf(frame.locator(".summary .notice"), page.locator(".interactive-input-part").last())
  await sleep(2800)
  await shoot(page, images, "placed")
  recorder.mark("send-resend")
  const send = page.locator(".interactive-input-part").last().getByRole("button", { name: /^送信/ }).first()
  await pointer.click(send)
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
  const llm = await startFakeLlm(trigger, todoSpec, reply, followUp)
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
    const recorder = new Recorder(page, frames)
    const pointer = new Pointer(page, () => recorder)
    await tidy(page, pointer)
    await recorder.start()
    const regions = await scenario(page, pointer, paths.images, recorder)
    const video = join(paths.work, "capture.mp4")
    await recorder.stop(
      video,
      `scale=${view.width * density}:${(view.height + view.y) * density}:flags=lanczos,crop=${view.width * density}:${view.height * density}:${view.x * density}:${view.y * density}`
    )
    const capture: Capture = { video, size: { width: view.width * density, height: view.height * density }, marks: recorder.marks, regions }
    await writeFile(join(paths.work, "capture.json"), JSON.stringify(capture, undefined, 2))
    return capture
  } finally {
    await writeFile(
      join(paths.work, "llm.json"),
      JSON.stringify({ toolCalls: llm.toolCalls, toolResults: llm.toolResults, requests: llm.requests.length }, undefined, 2)
    )
    await cleanUp(app, llm, profile)
  }
}
