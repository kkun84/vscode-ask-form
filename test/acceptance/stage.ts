import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Frame, type Locator, type Page } from "@playwright/test"
import { deploySpec } from "../fixtures/deploy.ts"
import { themeContext } from "../support/themes.ts"
import { openForm, startServer } from "../support/ui.ts"
import { sleep } from "./frames.ts"
import { Pointer, Recorder, typeNumber } from "./recording.ts"
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
body { font-family: "Noto Sans CJK JP", "Noto Sans JP", sans-serif; color: #e8edf5;
  background: radial-gradient(900px 600px at 0% 0%, #1d3b66 0%, transparent 60%), radial-gradient(800px 500px at 100% 100%, #2a1f5c 0%, transparent 55%), #0b1020 !important; }
body > iframe#form { position: absolute; left: -9999px; }
#stage { position: absolute; inset: 0; display: grid; grid-template-columns: 430px 1fr; gap: 28px; padding: 32px 36px 32px 44px; box-sizing: border-box; }
#caption { align-self: center; position: relative; z-index: 60; }
#caption .step { font-size: 22px; font-weight: 700; letter-spacing: 3px; color: #5cc8ff; margin-bottom: 18px; white-space: pre; }
#caption .text { font-size: 38px; font-weight: 800; line-height: 1.35; }
#caption em { font-style: normal; color: #5cc8ff; }
#caption.swap { animation: swap 450ms ease-out; }
@keyframes swap { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
.window { display: grid; grid-template-rows: 34px 1fr 26px; background: #1f1f1f; border-radius: 14px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); font-family: "Noto Sans CJK JP", sans-serif; }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #181818; color: #9d9d9d; font-size: 13px; border-bottom: 1px solid #2b2b2b; }
.titlebar i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.titlebar .name { margin-left: 14px; }
.main { display: grid; grid-template-columns: 46px 1fr; min-height: 0; }
.activity { background: #181818; border-right: 1px solid #2b2b2b; display: flex; flex-direction: column; align-items: center; gap: 18px; padding-top: 14px; }
.activity span { width: 20px; height: 20px; border-radius: 5px; border: 2px solid #6e6e6e; opacity: .7; }
.chat { display: grid; grid-template-rows: 32px 1fr auto; min-height: 0; }
.chat-header { display: flex; align-items: center; padding: 0 18px; font-size: 12px; letter-spacing: 1px; color: #bbbbbb; border-bottom: 1px solid #2b2b2b; }
#messages { overflow: hidden; padding: 18px 26px 10px; display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }
.user { align-self: flex-end; max-width: 78%; background: #2a2d2e; border: 1px solid #3c3c3c; border-radius: 12px; padding: 9px 14px; font-size: 14px; line-height: 1.6; animation: pop 300ms ease-out; }
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
#focus { position: fixed; border: 3px solid #5cc8ff; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(5,10,25,.45), 0 0 24px rgba(92,200,255,.6); pointer-events: none; opacity: 0; transition: opacity 350ms; z-index: 50; }
#focus.on { opacity: 1; }
@keyframes pop { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes rise { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
@keyframes spin { to { transform: rotate(360deg) } }
`

const markup = `
<div id="stage">
  <div id="caption"><div class="step"></div><div class="text"></div></div>
  <div class="window">
    <div class="titlebar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="name">api-gateway — Visual Studio Code</span></div>
    <div class="main">
      <div class="activity"><span></span><span></span><span></span><span></span></div>
      <div class="chat">
        <div class="chat-header">チャット</div>
        <div id="messages"></div>
        <div id="input"><div class="chips"></div><div class="text"></div><div class="bar"><span>Agent</span><span>GitHub Copilot</span><span class="send">↑</span></div></div>
      </div>
    </div>
    <div class="status"><span>main</span><span>0 ⚠ 0</span><span id="waiting">Copilotが回答を待っています</span></div>
  </div>
</div>
<div id="focus"></div>`

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

const scrollTo = (page: Page, selector: string, align: "start" | "end") =>
  page.evaluate(
    (options) => {
      const list = document.querySelector<HTMLElement>("#messages")
      const target = document.querySelector<HTMLElement>(options.selector)
      if (list === null || target === null) {
        return
      }
      const top =
        options.align === "start"
          ? target.offsetTop - list.offsetTop - 14
          : target.offsetTop - list.offsetTop + target.offsetHeight - list.clientHeight + 14
      list.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
    },
    { selector, align }
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

const focusOn = async (page: Page, target: Locator | null): Promise<void> => {
  const box = target === null ? null : await target.boundingBox()
  await page.evaluate((rect) => {
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
    focus.classList.add("on")
  }, box)
}

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
    document.querySelector("#messages")?.insertAdjacentHTML("beforeend", content)
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

const ask = async (page: Page, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await caption(page, 0)
  await sleep(700)
  await pointer.click(page.locator("#input .text"))
  await page.evaluate(() => document.querySelector("#input")?.classList.add("focus"))
  recorder.mark("typing")
  await typeInto(page, recorder, query, 40)
  await send(page, pointer, `<div class="user" style="order:1">${query}</div>`)
  recorder.mark("send")
  await sleep(500)
  await append(
    page,
    '<div class="tool" id="tool" style="order:2"><span class="spin"></span><span id="tool-label">Ask with a form を実行しています</span></div>'
  )
  await sleep(700)
  await caption(page, 1)
  await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(".formbox")
    if (box !== null) {
      box.style.display = "block"
    }
    document.querySelector("#waiting")?.classList.add("on")
  })
  recorder.mark("form")
  await sleep(300)
  await scrollTo(page, ".formbox", "start")
  await sleep(2400)
}

const editAndAnswer = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await caption(page, 2)
  await typeNumber(pointer, recorder, frame, "レプリカ数", "5")
  await focusOn(page, frame.locator(".metrics, .computed, .result").first())
  await sleep(1800)
  await focusOn(page, null)
  await caption(page, 3)
  await scrollTo(page, ".formbox", "end")
  await sleep(600)
  await pointer.click(frame.getByRole("button", { name: "この設定で進める" }))
  await frame.locator(".summary").waitFor()
  recorder.mark("answered")
  await page.evaluate(() => {
    document.querySelector("#tool")?.classList.add("done")
    const label = document.querySelector("#tool-label")
    if (label !== null) {
      label.textContent = "Ask with a form を実行しました"
    }
    document.querySelector("#waiting")?.classList.remove("on")
  })
  await sleep(400)
  await stream(page, "reply", reply, 4)
  await scrollTo(page, "#reply", "end")
  await sleep(1400)
}

const resendStep = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  const resend = resendText()
  await caption(page, 4)
  await scrollTo(page, ".formbox", "start")
  await sleep(500)
  await pointer.click(frame.getByRole("button", { name: "変更して送り直す" }))
  await sleep(500)
  await typeNumber(pointer, recorder, frame, "CPU(1台あたり)", "1000")
  await scrollTo(page, ".formbox", "end")
  await sleep(700)
  await pointer.click(frame.getByRole("button", { name: "変更を送信" }))
  await frame.locator(".summary .notice").waitFor()
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
  await focusOn(page, page.locator("#input"))
  await sleep(1500)
  await focusOn(page, null)
  await send(page, pointer, `<div class="user" id="resent" style="order:5">${chip(resend.file)}<div>${resend.text}</div></div>`)
  await sleep(300)
  await scrollTo(page, "#resent", "start")
  await sleep(400)
  await stream(page, "follow", followUp, 6)
  recorder.mark("followed")
  await scrollTo(page, "#follow", "end")
  await sleep(1500)
  recorder.mark("end")
}

const scene = async (page: Page, frame: Frame, pointer: Pointer, recorder: Recorder): Promise<void> => {
  await ask(page, pointer, recorder)
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
    await openForm(page, server, { args: deploySpec, context: themeContext("dark"), placeMessage: "placed" })
    await build(page)
    await sleep(800)
    const frame = page.frame({ url: /form\.html$/ })
    if (frame === null) {
      throw new Error("the form frame is missing")
    }
    await frame.locator("form.card").waitFor({ state: "attached" })
    await page.evaluate(() => document.fonts.ready)
    const recorder = new Recorder(page, frames)
    const pointer = new Pointer(page, () => recorder)
    await pointer.install({ x: 980, y: 520 })
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
