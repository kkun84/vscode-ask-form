import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Frame, type Locator, type Page } from "@playwright/test"
import { todoSpec } from "../fixtures/todo.ts"
import { themeContext } from "../support/themes.ts"
import { openForm, startServer } from "../support/ui.ts"
import { sleep } from "./frames.ts"
import { Pointer, Recorder } from "./recording.ts"
import { captions, followUp, query, reply, resendText } from "./stage-content.ts"

export interface Take {
  readonly video: string
  readonly size: { readonly width: number; readonly height: number }
  readonly marks: Readonly<Record<string, number>>
}

const viewport = { width: 1536, height: 864 }
const scale = 1.25
const style = `
html, body { margin: 0; width: ${viewport.width}px; height: ${viewport.height}px; overflow: hidden; }
body { font-family: "Noto Sans CJK JP", "Noto Sans JP", sans-serif; color: #f5f1e6;
  background: radial-gradient(900px 600px at 0% 0%, #4a3a0c 0%, transparent 60%), radial-gradient(800px 500px at 100% 100%, #4a2208 0%, transparent 55%), #14110a !important; }
body > iframe#form { position: absolute; left: -9999px; }
#stage { position: absolute; inset: 0; }
#caption { position: absolute; left: 0; right: 0; top: 30px; z-index: 60; display: flex; align-items: center; justify-content: center; gap: 22px; }
#caption .step { font-size: 24px; font-weight: 800; color: #14110a; background: #ffd23f; border-radius: 999px; padding: 6px 20px; white-space: pre; }
#caption .text { font-size: 46px; font-weight: 800; }
#viewport { position: absolute; left: 32px; right: 32px; top: 128px; bottom: 24px; overflow: clip; border-radius: 16px; }
#camera { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform 700ms cubic-bezier(.45,0,.2,1); }
#caption em { font-style: normal; color: #ffd23f; }
#caption.swap { animation: swap 450ms ease-out; }
@keyframes swap { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
.window { width: 680px; min-height: 760px; display: grid; grid-template-rows: 34px 1fr 26px; background: #1f1f1f; border-radius: 14px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); font-family: "Noto Sans CJK JP", sans-serif; }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #181818; color: #9d9d9d; font-size: 13px; border-bottom: 1px solid #2b2b2b; }
.titlebar i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.titlebar .name { margin-left: 14px; }
.main { display: grid; grid-template-columns: 46px 1fr; }
.activity { background: #181818; border-right: 1px solid #2b2b2b; display: flex; flex-direction: column; align-items: center; gap: 18px; padding-top: 14px; }
.activity span { width: 20px; height: 20px; border-radius: 5px; border: 2px solid #6e6e6e; opacity: .7; }
.chat { display: grid; grid-template-rows: 32px 1fr auto; }
.chat-header { display: flex; align-items: center; padding: 0 18px; font-size: 12px; letter-spacing: 1px; color: #bbbbbb; border-bottom: 1px solid #2b2b2b; }
#messages { min-height: 520px; padding: 18px 26px 10px; display: flex; flex-direction: column; justify-content: flex-end; gap: 14px; }
.user { align-self: flex-end; max-width: 78%; background: #1b2834; border: 1px solid #2b3d50; border-radius: 12px; padding: 9px 14px; font-size: 14px; line-height: 1.6; animation: pop 300ms ease-out; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #cccccc; background: #2b2b2b; border: 1px solid #3c3c3c; border-radius: 5px; padding: 2px 8px; margin-bottom: 6px; }
.chip b { color: #e8c07d; font-weight: 400; }
.tool { font-size: 13px; color: #9d9d9d; display: flex; align-items: center; gap: 8px; animation: pop 300ms ease-out; }
.tool .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #4daafc; border-top-color: transparent; animation: spin 900ms linear infinite; }
.tool.done .spin { animation: none; border-color: #73c991; }
.formbox { order: 3; animation: rise 500ms cubic-bezier(.2,.8,.2,1); }
.formbox iframe { width: 100%; border: 0; display: block; background: transparent; }
.assistant { font-size: 14px; line-height: 1.7; color: #d4d4d4; }
#input { margin: 6px 22px 14px; border: 1px solid #3c3c3c; border-radius: 10px; background: #252526; padding: 10px 12px 8px; transition: border-color 200ms; }
#input.focus { border-color: #0078d4; }
#input .text { min-height: 22px; font-size: 14px; color: #e0e0e0; line-height: 1.6; }
#input .text:empty::before { content: "Copilotに頼む内容を入力"; color: #6e6e6e; }
#input .bar { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; color: #9d9d9d; }
#input .send { margin-left: auto; width: 26px; height: 26px; border-radius: 50%; background: #0078d4; display: flex; align-items: center; justify-content: center; color: white; font-size: 15px; }
.status { display: flex; align-items: center; gap: 16px; padding: 0 12px; background: #181818; border-top: 1px solid #2b2b2b; font-size: 12px; color: #9d9d9d; }
#waiting { margin-left: auto; background: #6c5b00; color: #fff3c4; padding: 2px 10px; border-radius: 3px; opacity: 0; transition: opacity 300ms; }
#waiting.on { opacity: 1; }
#focus { position: fixed; border: 3px solid #ffd23f; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(20,15,5,.5), 0 0 24px rgba(255,210,63,.6); pointer-events: none; opacity: 0; transition: opacity 350ms; z-index: 50; }
#focus.on { opacity: 1; }
#focus .label { position: absolute; left: -3px; bottom: calc(100% + 10px); background: #ffd23f; color: #14110a; font-weight: 800; font-size: 30px; padding: 6px 18px; border-radius: 9px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
#focus.below .label { bottom: auto; top: calc(100% + 10px); }
@keyframes pop { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes rise { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
@keyframes spin { to { transform: rotate(360deg) } }
`

const markup = `
<div id="stage">
  <div id="caption"><div class="step"></div><div class="text"></div></div>
  <div id="viewport"><div id="camera"><div class="window">
    <div class="titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="name">my-todo — Visual Studio Code</span></div>
    <div class="main">
      <div class="activity"><span></span><span></span><span></span><span></span></div>
      <div class="chat">
        <div class="chat-header">チャット</div>
        <div id="messages"></div>
        <div id="input"><div class="chips"></div><div class="text"></div><div class="bar"><span>Agent</span><span>GitHub Copilot</span><span class="send">↑</span></div></div>
      </div>
    </div>
    <div class="status"><span>main</span><span>0 ⚠ 0</span><span id="waiting">Copilotが回答を待っています</span></div>
  </div></div></div>
</div>
<div id="focus"><div class="label"></div></div>`

const build = (page: Page) =>
  page.evaluate(
    ({ css, html }) => {
      const sheet = document.createElement("style")
      sheet.textContent = css
      document.head.append(sheet)
      document.body.insertAdjacentHTML("beforeend", html)
      const frame = document.querySelector<HTMLIFrameElement>("iframe#form")
      const box = document.createElement("div")
      box.className = "formbox"
      box.style.display = "none"
      if (frame !== null) {
        box.append(frame)
      }
      document.querySelector("#messages")?.append(box)
      setInterval(() => {
        const app = frame?.contentDocument?.querySelector("#app")
        const height = app === null || app === undefined ? undefined : Math.ceil(app.getBoundingClientRect().bottom) + 12
        if (frame !== null && height !== undefined && height > 0) {
          frame.style.height = `${height}px`
        }
      }, 50)
    },
    { css: style, html: markup }
  )

const caption = (page: Page, index: number) =>
  page.evaluate(
    (item) => {
      const box = document.querySelector("#caption")
      box?.classList.remove("swap")
      void (box as HTMLElement | null)?.offsetWidth
      box?.classList.add("swap")
      const step = box?.querySelector(".step")
      const text = box?.querySelector(".text")
      if (step && text) {
        step.textContent = item.step
        text.innerHTML = item.text
      }
    },
    captions[index] ?? { step: "", text: "" }
  )

const append = (page: Page, html: string) =>
  page.evaluate((content) => {
    document.querySelector("#messages")?.insertAdjacentHTML("beforeend", content)
  }, html)

const stream = async (page: Page, id: string, text: string, order: number): Promise<void> => {
  await append(page, `<div class="assistant" id="${id}" style="order:${order}"></div>`)
  for (let index = 0; index < text.length; index += 3) {
    await page.evaluate(
      (part) => {
        const target = document.querySelector(`#${part.id}`)
        if (target !== null) {
          target.textContent += part.chunk
        }
      },
      { id, chunk: text.slice(index, index + 3) }
    )
    await sleep(22)
  }
}

const focusOn = async (page: Page, target: Locator | null, label = ""): Promise<void> => {
  const box = target === null ? null : await target.boundingBox()
  await page.evaluate(
    ({ rect, text }) => {
      const focus = document.querySelector<HTMLElement>("#focus")
      if (focus === null) {
        return
      }
      if (rect === null) {
        focus.classList.remove("on")
        return
      }
      Object.assign(focus.style, {
        left: `${rect.x - 8}px`,
        top: `${rect.y - 8}px`,
        width: `${rect.width + 16}px`,
        height: `${rect.height + 16}px`
      })
      const tag = focus.querySelector(".label")
      if (tag !== null) {
        tag.textContent = text
      }
      focus.classList.toggle("below", rect.y < 200)
      focus.classList.add("on")
    },
    { rect: box, text: label }
  )
}

const boxOf = async (...targets: ReadonlyArray<Locator>) => {
  const boxes = (await Promise.all(targets.map((target) => target.boundingBox()))).filter((box) => box !== null)
  if (boxes.length === 0) {
    return null
  }
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  return {
    x: left,
    y: top,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - left,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - top
  }
}

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Lens {
  readonly s: number
  readonly x: number
  readonly y: number
}

interface Rig {
  readonly view: Box
  readonly state: Lens
  readonly room: { readonly width: number; readonly height: number }
}

const readRig = (page: Page): Promise<Rig> =>
  page.evaluate(() => {
    const rect = document.querySelector<HTMLElement>("#viewport")?.getBoundingClientRect()
    const room = document.querySelector<HTMLElement>(".window")
    return {
      view: { x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 },
      state: (window as unknown as { lens?: Lens }).lens ?? { s: 1, x: 0, y: 0 },
      room: { width: room?.offsetWidth ?? 680, height: room?.offsetHeight ?? 760 }
    }
  })

const applyLens = (page: Page, next: Lens, cut: boolean) =>
  page.evaluate(
    ({ lens: value, cut: instant }) => {
      const lens = document.querySelector<HTMLElement>("#camera")
      ;(window as unknown as { lens?: Lens }).lens = value
      if (lens !== null) {
        lens.style.transition = instant ? "none" : ""
        lens.style.transform = `translate(${value.x}px, ${value.y}px) scale(${value.s})`
      }
    },
    { lens: next, cut }
  )

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

const visible = ({ view, state, room }: Rig): Box => {
  const x = Math.max(0, -state.x / state.s)
  const y = Math.max(0, -state.y / state.s)
  const right = Math.min((view.width - state.x) / state.s, room.width)
  const bottom = Math.min((view.height - state.y) / state.s, room.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

const contains = (box: Box, x: number, y: number) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height

const goalOf = (rig: Rig, rect: Box | null, pad: number): Box => {
  const { view, state, room } = rig
  const local =
    rect === null
      ? { x: 0, y: 0, width: room.width, height: room.height }
      : {
          x: (rect.x - view.x - state.x) / state.s,
          y: (rect.y - view.y - state.y) / state.s,
          width: rect.width / state.s,
          height: rect.height / state.s
        }
  return { x: local.x - pad, y: local.y - pad, width: local.width + pad * 2, height: local.height + pad * 2 }
}

const aim = async (page: Page, rect: Box | null, pad: number, most: number, still: boolean): Promise<boolean> => {
  const rig = await readRig(page)
  const goal = goalOf(rig, rect, pad)
  const seen = visible(rig)
  const far = !still && rect !== null && !contains(seen, goal.x + goal.width / 2, goal.y + goal.height / 2)
  const frame = far ? union(goal, seen) : goal
  const { view } = rig
  const s = Math.min(view.width / frame.width, view.height / frame.height, far ? rig.state.s : most)
  await applyLens(
    page,
    { s, x: (view.width - frame.width * s) / 2 - frame.x * s, y: (view.height - frame.height * s) / 2 - frame.y * s },
    still
  )
  return far
}

const camera = async (page: Page, targets: ReadonlyArray<Locator>, pad: number, most: number, still = false): Promise<void> => {
  const rect = targets.length === 0 ? null : await boxOf(...targets)
  if (await aim(page, rect, pad, most, still)) {
    await sleep(750)
    await camera(page, targets, pad, most, still)
    return
  }
  await sleep(still ? 50 : 800)
}

const pin = (page: Page, selector: string, ms: number) =>
  page.evaluate(
    ({ selector: pick, ms: span }) => {
      const anchor = document.querySelector<HTMLElement>(pick)
      const lens = document.querySelector<HTMLElement>("#camera")
      const holder = window as unknown as { lens?: { s: number; x: number; y: number } }
      if (anchor === null || lens === null || holder.lens === undefined) {
        return
      }
      const state = holder.lens
      const fixed = anchor.getBoundingClientRect().bottom
      const end = performance.now() + span
      lens.style.transition = "none"
      const tick = () => {
        state.y -= anchor.getBoundingClientRect().bottom - fixed
        lens.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.s})`
        if (performance.now() < end) {
          requestAnimationFrame(tick)
        } else {
          lens.style.transition = ""
        }
      }
      requestAnimationFrame(tick)
    },
    { selector, ms }
  )

const typeInto = async (page: Page, recorder: Recorder, text: string, delay: number): Promise<void> => {
  for (const character of text) {
    await page.evaluate((c) => {
      const box = document.querySelector("#input .text")
      if (box !== null) {
        box.textContent += c
      }
    }, character)
    recorder.sound("key")
    await sleep(delay)
  }
}

const send = async (page: Page, pointer: Pointer, html: string): Promise<void> => {
  await pointer.click(page.locator("#input .send"))
  await page.evaluate((content) => {
    const input = document.querySelector<HTMLElement>("#input")
    const before = input?.getBoundingClientRect().top ?? 0
    document.querySelector("#messages")?.insertAdjacentHTML("beforeend", content)
    const holder = window as unknown as { lens?: { s: number; x: number; y: number } }
    const lens = document.querySelector<HTMLElement>("#camera")
    if (holder.lens !== undefined && lens !== null) {
      holder.lens.y -= (input?.getBoundingClientRect().top ?? 0) - before
      lens.style.transition = "none"
      lens.style.transform = `translate(${holder.lens.x}px, ${holder.lens.y}px) scale(${holder.lens.s})`
      void lens.offsetWidth
      lens.style.transition = ""
    }
    const text = document.querySelector("#input .text")
    const chips = document.querySelector("#input .chips")
    if (text !== null && chips !== null) {
      text.textContent = ""
      chips.textContent = ""
    }
    document.querySelector("#input")?.classList.remove("focus")
  }, html)
}

const chip = (file: string) => `<div class="chip"><b>{ }</b>${file}</div>`

const guide: { pointer?: Pointer } = {}

const look = async (page: Page, targets: ReadonlyArray<Locator>, spot: Locator, label: string, hold: number): Promise<void> => {
  await focusOn(page, null)
  await guide.pointer?.pointAt(spot)
  await camera(page, targets, 24, 2.4)
  await focusOn(page, spot, label)
  await sleep(hold)
}

interface Slide {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly from: number
  readonly to: number
  readonly note: string
}

const slide = async (page: Page, frame: Frame, pointer: Pointer, plan: Slide): Promise<void> => {
  const slider = frame.getByRole("slider", { name: plan.label })
  const field = slider.locator("xpath=ancestor::div[contains(concat(' ', @class, ' '), ' field ')][1]")
  await look(page, [field], field, plan.note, 300)
  const ratio = (value: number) => (value - plan.min) / (plan.max - plan.min)
  await pointer.drag(slider, ratio(plan.from), ratio(plan.to))
  await sleep(300)
}

const ask = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await camera(page, [], 0, 1, true)
  await caption(page, 0)
  await sleep(500)
  await look(page, [page.locator("#input")], page.locator("#input"), "ここに頼む", 200)
  await pointer.click(page.locator("#input .text"))
  await page.evaluate(() => document.querySelector("#input")?.classList.add("focus"))
  recorder.mark("typing")
  await typeInto(page, recorder, query, 38)
  await focusOn(page, null)
  await send(page, pointer, `<div class="user" style="order:1">${query}</div>`)
  recorder.mark("send")
  await append(
    page,
    '<div class="tool" id="tool" style="order:2"><span class="spin"></span><span id="tool-label">Ask with a form を実行しています</span></div>'
  )
  await camera(page, [page.locator(".user").first(), page.locator("#tool")], 24, 1.8)
  await caption(page, 1)
  await pin(page, "#tool", 900)
  await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".formbox")
    if (box !== null) {
      box.style.display = "block"
    }
    document.querySelector("#waiting")?.classList.add("on")
  })
  recorder.mark("form")
  await sleep(900)
  const first = frame.locator(".hint").first()
  await look(page, [frame.locator("form.card h1"), first], first, "AIの推測と根拠", 1800)
}

const editAndAnswer = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await caption(page, 2)
  await slide(page, frame, pointer, {
    label: "メモの最大文字数",
    min: 100,
    max: 5000,
    from: 100,
    to: 5000,
    note: "メモを100→5000文字に"
  })
  await look(page, [frame.locator(".computed")], frame.locator(".computed"), "保存できる件数: 8,533件→501件", 1400)
  await caption(page, 3)
  const proceed = frame.getByRole("button", { name: "この設定で作る" })
  await look(page, [frame.locator("footer.actions")], proceed, "クリックで回答", 400)
  await focusOn(page, null)
  await pin(page, ".formbox", 1600)
  await pointer.click(proceed)
  await frame.locator(".summary").waitFor()
  await sleep(800)
  recorder.mark("answered")
  await page.evaluate(() => {
    document.querySelector("#tool")?.classList.add("done")
    const label = document.querySelector("#tool-label")
    if (label !== null) {
      label.textContent = "Ask with a form を実行しました"
    }
    document.querySelector("#waiting")?.classList.remove("on")
  })
  await look(page, [frame.locator(".summary")], frame.locator(".summary"), "回答がCopilotに届いた", 1300)
  await focusOn(page, null)
  await stream(page, "reply", reply, 4)
  await sleep(300)
  await look(page, [page.locator("#reply")], page.locator("#reply"), "この値で作り始める", 1500)
}

const resendStep = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  const resend = resendText()
  await caption(page, 4)
  const again = frame.getByRole("button", { name: "変更して送り直す" })
  await look(page, [frame.locator(".summary")], again, "あとで変えたくなったら", 500)
  await focusOn(page, null)
  await pointer.click(again)
  await sleep(600)
  await slide(page, frame, pointer, { label: "1ページの件数", min: 5, max: 100, from: 20, to: 50, note: "1ページを20→50件に" })
  const submit = frame.getByRole("button", { name: "変更を送信" })
  await look(page, [frame.locator("footer.actions")], submit, "変更を送信", 400)
  await focusOn(page, null)
  await pin(page, ".formbox", 1600)
  await pointer.click(submit)
  await frame.locator(".summary .notice").waitFor()
  await sleep(800)
  await page.evaluate(
    ({ text, chipHtml }) => {
      document.querySelector("#input")?.classList.add("focus")
      document.querySelector("#input .chips")?.insertAdjacentHTML("beforeend", chipHtml)
      const box = document.querySelector("#input .text")
      if (box !== null) {
        box.textContent = text
      }
    },
    { text: resend.text, chipHtml: chip(resend.file) }
  )
  recorder.mark("placed")
  await look(page, [page.locator("#input")], page.locator("#input"), "変えた所の説明が入力欄に入る", 1700)
  await focusOn(page, null)
  await send(page, pointer, `<div class="user" id="resent" style="order:5">${chip(resend.file)}<div>${resend.text}</div></div>`)
  await camera(page, [page.locator("#resent")], 24, 2.4)
  await stream(page, "follow", followUp, 6)
  recorder.mark("followed")
  await look(page, [page.locator("#follow")], page.locator("#follow"), "変更を反映して続ける", 1400)
  recorder.mark("end")
}

const scene = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await ask(page, frame, pointer, recorder)
  await editAndAnswer(page, frame, pointer, recorder)
  await resendStep(page, frame, pointer, recorder)
}

export const captureStage = async (work: string): Promise<Take> => {
  const frames = join(work, "stage-frames")
  await rm(frames, { recursive: true, force: true })
  await mkdir(frames, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ args: ["--no-sandbox"] })
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: scale })
    await openForm(page, server, { args: todoSpec, context: themeContext("dark"), placeMessage: "placed" })
    await build(page)
    await sleep(800)
    const frame = page.frame({ url: /form\.html$/ })
    if (frame === null) {
      throw new Error("the form frame is missing")
    }
    await frame.locator("form.card").waitFor({ state: "attached" })
    await page.evaluate(() => document.fonts.ready)
    const recorder = new Recorder(page, frames)
    const pointer = new Pointer(page, () => recorder, { host: "#camera", size: 28 })
    await camera(page, [], 0, 1, true)
    await pointer.install({ x: 1000, y: 640 })
    guide.pointer = pointer
    await sleep(500)
    await recorder.start()
    await scene(page, frame, pointer, recorder)
    const video = join(work, "stage.mp4")
    const size = { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) }
    await recorder.stop(video, `scale=${size.width}:${size.height}:flags=lanczos`)
    const take: Take = { video, size, marks: recorder.marks }
    await writeFile(join(work, "stage.json"), JSON.stringify(take, undefined, 2))
    return take
  } finally {
    await browser.close()
    await server.close()
  }
}
