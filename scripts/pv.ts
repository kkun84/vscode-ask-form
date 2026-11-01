import { spawnSync } from "node:child_process"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { chromium, type Page } from "@playwright/test"
import type { Take as Recording } from "../test/acceptance/stage.ts"
import { renderAudio, type Cue } from "./pv-audio.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const work = join(root, "test-results/media/pv")
const output = join(root, "docs/media/ask-form-pv.mp4")
const poster = join(root, "docs/images/pv-poster.png")
const frame = { width: 1920, height: 1080 }
const fade = 0.25

interface Card {
  readonly kind: "card"
  readonly name: string
  readonly duration: number
  readonly body: string
}

interface Take {
  readonly kind: "take"
  readonly name: string
  readonly from: number
  readonly to: number
  readonly speed: number
}

type Scene = Card | Take

const style = `
* { box-sizing: border-box; margin: 0; }
body { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; color: #f4f7fb;
  font-family: "Noto Sans CJK JP", "Noto Sans JP", sans-serif;
  background: radial-gradient(1200px 700px at 20% 0%, #1d3b66 0%, transparent 60%),
              radial-gradient(900px 600px at 100% 100%, #2a1f5c 0%, transparent 55%), #0b1020; }
.accent { color: #5cc8ff; }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 28px; }
.logo { font-size: 150px; font-weight: 800; letter-spacing: -2px; }
.logo span { color: #5cc8ff; }
.tagline { font-size: 64px; font-weight: 700; }
.sub { font-size: 34px; color: #b8c4d8; }
.pill { font-size: 28px; padding: 10px 26px; border-radius: 999px; background: rgba(92,200,255,.14); color: #9fdcff; border: 1px solid rgba(92,200,255,.35); }
.head { position: absolute; left: 0; right: 0; top: 64px; text-align: center; }
.step { display: inline-block; font-size: 26px; font-weight: 700; letter-spacing: 2px; color: #5cc8ff; margin-bottom: 14px; }
.caption { font-size: 56px; font-weight: 800; }
.shot { position: absolute; border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); background: #1e1e1e; }
.chat { display: flex; flex-direction: column; gap: 22px; width: 1100px; }
.bubble { font-size: 36px; padding: 20px 30px; border-radius: 26px; max-width: 900px; }
.ai { align-self: flex-start; background: #1f2a44; border: 1px solid #2f3f66; }
.me { align-self: flex-end; background: #2a5bd7; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; width: 1500px; }
.tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 22px; padding: 34px 40px; text-align: left; }
.tile b { display: block; font-size: 40px; margin-bottom: 10px; }
.tile span { font-size: 30px; color: #b8c4d8; }
.url { font-size: 46px; font-weight: 700; color: #9fdcff; }
`

const page = (body: string) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`

const titleCard = `<div class="center">
  <div class="pill">VS Code 拡張機能 for GitHub Copilot</div>
  <div class="logo">Ask <span>Form</span></div>
  <div class="tagline">Copilotが、フォームで聞いてくる。</div>
</div>`

const problemCard = `<div class="center">
  <div class="tagline">AIからの確認、何往復していますか？</div>
  <div class="chat">
    <div class="bubble ai">画面はReactとVue、どちらで作りますか？</div>
    <div class="bubble me">Reactで。保存はブラウザでいいかな</div>
    <div class="bubble ai">メモは何文字まで？1ページは何件？締め切りは？</div>
    <div class="bubble me">えっと、それで何件まで保存できるんだっけ…</div>
  </div>
  <div class="sub">項目が多い質問や、値どうしが連動する質問は、文章だと答えにくい。</div>
</div>`

const featureCard = `<div class="center">
  <div class="tagline">ほかにも</div>
  <div class="grid">
    <div class="tile"><b>答え方を選べる</b><span>「AIに任せる」「チャットで答える」</span></div>
    <div class="tile"><b>待っていることが分かる</b><span>回答待ちをステータスバーに表示</span></div>
    <div class="tile"><b>デスクトップ版とweb版</b><span>チャットの中、またはvscode.devのパネルに</span></div>
    <div class="tile"><b>VS Codeになじむ</b><span>テーマ、日本語と英語、キーボード操作に対応</span></div>
  </div>
</div>`

const endCard = `<div class="center">
  <div class="logo">Ask <span>Form</span></div>
  <div class="tagline">AIの質問に、フォームで答えよう。</div>
  <div class="url">github.com/kkun84/vscode-ask-form</div>
  <div class="sub">VS Code 1.110以降 ・ MIT License</div>
</div>`

const run = (args: ReadonlyArray<string>): void => {
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr}`)
  }
}

const scenes = (take: Recording): ReadonlyArray<Scene> => [
  { kind: "card", name: "title", duration: 2, body: titleCard },
  { kind: "card", name: "problem", duration: 3.5, body: problemCard },
  { kind: "take", name: "demo", from: Math.max(0, (take.marks["typing"] ?? 0) - 0.8), to: take.marks["end"] ?? 0, speed: 1 },
  { kind: "card", name: "features", duration: 3, body: featureCard },
  { kind: "card", name: "end", duration: 2.5, body: endCard }
]

const draw = async (browser: Page, html: string, path: string, size = frame): Promise<void> => {
  await browser.setViewportSize(size)
  await browser.setContent(html)
  await browser.evaluate(() => document.fonts.ready)
  await browser.screenshot({ path, omitBackground: false })
}

const encode = ["-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high"]

const fades = (duration: number) => `fade=t=in:st=0:d=${fade},fade=t=out:st=${(duration - fade).toFixed(2)}:d=${fade}`

const renderCard = async (browser: Page, scene: Card, file: string): Promise<void> => {
  const still = join(work, `${scene.name}.png`)
  await draw(browser, page(scene.body), still)
  run([
    "-framerate",
    "30",
    "-i",
    still,
    "-vf",
    `format=yuv420p,loop=-1:1,trim=duration=${scene.duration},${fades(scene.duration)}`,
    ...encode,
    file
  ])
}

const renderTake = (take: Recording, scene: Take, file: string): void => {
  const duration = (scene.to - scene.from) / scene.speed
  run([
    "-ss",
    scene.from.toFixed(3),
    "-t",
    (scene.to - scene.from).toFixed(3),
    "-i",
    take.video,
    "-vf",
    `setpts=(PTS-STARTPTS)/${scene.speed},fps=30,scale=${frame.width}:${frame.height}:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,trim=duration=${duration.toFixed(3)},format=yuv420p,${fades(duration)}`,
    ...encode,
    file
  ])
}

const capture = JSON.parse(await readFile(join(root, "test-results/media/stage.json"), "utf8")) as Recording
await rm(work, { recursive: true, force: true })
await mkdir(work, { recursive: true })
await mkdir(join(root, "docs/media"), { recursive: true })
const browser = await chromium.launch({ args: ["--no-sandbox"] })
const files: Array<string> = []
try {
  const html = await browser.newPage()
  for (const [index, scene] of scenes(capture).entries()) {
    const file = join(work, `${String(index).padStart(2, "0")}-${scene.name}.mp4`)
    const partial = `${file}.part.mp4`
    if (scene.kind === "card") {
      await renderCard(html, scene, partial)
    } else {
      renderTake(capture, scene, partial)
    }
    await rename(partial, file)
    files.push(file)
    console.log(`rendered ${scene.name}`)
  }
} finally {
  await browser.close()
}
const timeline: Array<{ readonly scene: Scene; readonly start: number; readonly duration: number }> = []
for (const scene of scenes(capture)) {
  const previous = timeline.at(-1)
  const start = previous === undefined ? 0 : previous.start + previous.duration
  timeline.push({ scene, start, duration: scene.kind === "card" ? scene.duration : (scene.to - scene.from) / scene.speed })
}
const toVideo = (time: number): number | undefined => {
  for (const { scene, start, duration } of timeline) {
    if (scene.kind === "take" && time >= scene.from && time <= scene.to) {
      const at = start + (time - scene.from) / scene.speed
      return at <= start + duration ? at : undefined
    }
  }
  return undefined
}
const cueKind = (name: string): Cue["kind"] | undefined => {
  if (name.startsWith("key:")) {
    return "key"
  }
  if (name.startsWith("click:")) {
    return "click"
  }
  return ({ form: "pop", answered: "success", followed: "chime" } as Readonly<Record<string, Cue["kind"]>>)[name]
}
const markCues = Object.entries(capture.marks).flatMap(([name, time]): Array<Cue> => {
  const kind = cueKind(name)
  const at = toVideo(time)
  return kind === undefined || at === undefined ? [] : [{ at, kind }]
})
const sceneCues = timeline.flatMap(({ scene, start }, index): Array<Cue> => {
  if (scene.name === "title" || scene.name === "end") {
    return [{ at: start + 0.15, kind: "impact" }]
  }
  return index === 0 ? [] : [{ at: start, kind: "whoosh" }]
})
const last = timeline.at(-1)
const total = last === undefined ? 0 : last.start + last.duration
const grooveFrom = timeline.find(({ scene }) => scene.kind === "take")?.start ?? 0
const grooveUntil = timeline.find(({ scene }) => scene.name === "end")?.start ?? total
const audio = join(work, "audio.wav")
await renderAudio({ duration: total, beatsFrom: grooveFrom, beatsUntil: grooveUntil, cues: [...sceneCues, ...markCues] }, audio)
const list = join(work, "scenes.txt")
await writeFile(list, files.map((file) => `file '${file}'`).join("\n"))
const joined = join(work, "joined.mp4")
run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined])
run([
  "-i",
  joined,
  "-i",
  audio,
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-c:v",
  "copy",
  "-af",
  "highshelf=f=7000:g=-4,loudnorm=I=-30:TP=-9:LRA=11",
  "-ar",
  "48000",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-shortest",
  "-movflags",
  "+faststart",
  `${output}.part.mp4`
])
await rename(`${output}.part.mp4`, output)
const still = await chromium.launch({ args: ["--no-sandbox"] })
try {
  const html = await still.newPage()
  await draw(
    html,
    page(
      `${titleCard}<div style="position:absolute;left:50%;bottom:120px;transform:translateX(-50%);display:flex;align-items:center;gap:22px;font-size:40px;font-weight:700"><div style="width:96px;height:96px;border-radius:50%;background:#5cc8ff;display:flex;align-items:center;justify-content:center"><div style="width:0;height:0;border-left:34px solid #0b1020;border-top:22px solid transparent;border-bottom:22px solid transparent;margin-left:8px"></div></div>1分で分かる紹介動画</div>`
    ),
    join(work, "poster.png")
  )
} finally {
  await still.close()
}
run(["-i", join(work, "poster.png"), "-vf", "scale=1280:-1", poster])
console.log(`wrote ${output}`)
