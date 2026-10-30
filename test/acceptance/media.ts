import { spawnSync } from "node:child_process"
import { access, mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ElectronApplication, Frame, Page } from "@playwright/test"
import { eventSpec } from "../fixtures/event.ts"
import { startFakeLlm } from "./fake-llm.ts"
import { formFrame, sleep, until } from "./frames.ts"
import { cleanUp, closeApp, fitWindow, launchVscode, type VscodePaths } from "./vscode.ts"

export interface MediaPaths extends VscodePaths {
  readonly cli: string
  readonly output: string
}

const query = "来月の技術交流会の条件を決めたいです。フォームで聞いてください。"
const trigger = "フォームで聞いて"
const reply =
  "ありがとうございます。参加者150人、参加費¥2,000、ライブ配信ありで進めます。収支は¥130,000の黒字見込みです。会場と配信の手配を始めます。"
const followUp = "参加費¥2,500で計算し直しました。収支は¥205,000の黒字見込みです。案内文の参加費も更新します。"
const size = { width: 1280, height: 1120 }

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

const titleBar = 36

const shoot = (page: Page, output: string, name: string) =>
  page.screenshot({ path: join(output, `${name}.png`), clip: { x: 0, y: titleBar, width: size.width, height: size.height - titleBar } })

const typeNumber = async (frame: Frame, label: string, value: string): Promise<void> => {
  const input = frame.getByRole("spinbutton", { name: label })
  await input.click()
  await input.press("ControlOrMeta+a")
  await input.pressSequentially(value, { delay: 150 })
  await frame.locator("h1").click()
}

const tidy = async (window: Page): Promise<void> => {
  await window.addStyleTag({ content: ".notifications-toasts { display: none !important; }" })
  await window
    .locator(".chat-input-notification-dismiss")
    .first()
    .click({ timeout: 10_000 })
    .catch(() => null)
}

const scenario = async (window: Page, output: string): Promise<number> => {
  const frame = await formFrame(window)
  const shownAt = Date.now()
  await tidy(window)
  await frame.locator("h1").scrollIntoViewIfNeeded()
  await sleep(1500)
  await shoot(window, output, "form")
  await typeNumber(frame, "参加者数", "150")
  await sleep(1200)
  await shoot(window, output, "edited")
  await frame.locator("form.card button.primary").click()
  await window
    .locator(".interactive-response", { hasText: reply.slice(0, 12) })
    .last()
    .waitFor({ timeout: 60_000 })
  await sleep(2000)
  await shoot(window, output, "answered")
  await frame.getByRole("button", { name: "変更して送り直す" }).click()
  await sleep(800)
  await typeNumber(frame, "参加費", "2500")
  await sleep(1200)
  await frame.getByRole("button", { name: "変更を送信" }).click()
  await frame.locator(".summary .notice").waitFor()
  await sleep(2500)
  await shoot(window, output, "placed")
  await window.locator(".interactive-input-part .monaco-editor .view-lines").last().click()
  await window.keyboard.press("End")
  await window.keyboard.press("Enter")
  await window
    .locator(".interactive-response", { hasText: followUp.slice(0, 12) })
    .last()
    .waitFor({ timeout: 60_000 })
  await sleep(3000)
  return shownAt
}

const toGif = (video: string, gif: string, start: number): void =>
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    start.toFixed(2),
    "-i",
    video,
    "-vf",
    `crop=${size.width}:${size.height - titleBar}:0:${titleBar},fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    gif
  ])

const settings = {
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.secondarySideBar.defaultVisibility": "maximized",
  "window.titleBarStyle": "native",
  "window.menuBarVisibility": "hidden"
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

export const captureMedia = async (paths: MediaPaths): Promise<void> => {
  await mkdir(paths.output, { recursive: true })
  const profile = await mkdtemp(join(tmpdir(), "ask-form-media-"))
  const llm = await startFakeLlm(trigger, eventSpec, reply, followUp)
  const options = { llm, log: join(profile, "driver.log"), profile, locale: "ja", query, settings }
  let app: ElectronApplication | undefined
  try {
    installLanguagePack(paths.cli, profile)
    await warmUp(paths, { ...options, query: "warm up" })
    const launchedAt = Date.now()
    app = await launchVscode(paths, { ...options, video: { dir: join(profile, "video"), size } })
    const window = await fitWindow(app, size)
    window.context().setDefaultTimeout(30_000)
    const shownAt = await scenario(window, paths.output)
    const video = window.video()
    await closeApp(app)
    app = undefined
    const recorded = join(profile, "flow.webm")
    await video?.saveAs(recorded)
    toGif(recorded, join(paths.output, "demo.gif"), Math.max(0, (shownAt - launchedAt) / 1000 - 0.5))
  } finally {
    await cleanUp(app, llm, profile)
  }
}
