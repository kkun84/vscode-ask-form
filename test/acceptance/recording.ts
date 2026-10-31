import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CDPSession, Frame, Locator, Page } from "@playwright/test"
import { sleep } from "./frames.ts"

export const run = (command: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
}

export class Recorder {
  private readonly frames: Array<{ readonly file: string; readonly at: number }> = []
  readonly marks: Record<string, number> = {}
  private readonly page: Page
  private readonly dir: string
  private session: CDPSession | undefined
  private startedAt = 0
  private writes: Array<Promise<void>> = []
  private sounds = 0

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
    await session.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1 })
  }

  mark(name: string): void {
    this.marks[name] = Date.now() / 1000 - this.startedAt
  }

  sound(kind: "click" | "key"): void {
    this.sounds++
    this.mark(`${kind}:${this.sounds}`)
  }

  async stop(output: string, filter: string): Promise<void> {
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
      `${filter},fps=30,format=yuv420p`,
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

const pointerPath = "M4 2 L4 20 L9 15 L12.5 22 L15.5 20.6 L12 13.8 L19 13.8 Z"

const center = async (target: Locator): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await target.boundingBox()
  if (box === null) {
    throw new Error("the target is not visible")
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export class Pointer {
  private readonly page: Page
  private readonly recorder: () => Recorder | undefined

  constructor(page: Page, recorder: () => Recorder | undefined) {
    this.page = page
    this.recorder = recorder
  }

  async install(start: { readonly x: number; readonly y: number }): Promise<void> {
    await this.page.evaluate(
      ({ d, x, y }) => {
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
        pointer.style.cssText = `position:fixed;left:0;top:0;width:52px;height:52px;z-index:2147483647;pointer-events:none;transition:transform 700ms cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));transform:translate(${x}px,${y}px)`
        svg.style.cssText = "width:52px;height:52px;pointer-events:none;transform-origin:8px 4px;transition:transform 120ms ease-out"
        document.body.append(pointer)
      },
      { d: pointerPath, ...start }
    )
  }

  async moveTo(target: Locator): Promise<void> {
    await this.place(await center(target), true)
    await sleep(800)
  }

  private async press(point: { readonly x: number; readonly y: number }, hold: boolean): Promise<void> {
    await this.page.evaluate(
      ({ x, y, keep }) => {
        const svg = document.querySelector<SVGElement>("#ask-form-pointer svg")
        if (svg !== null) {
          svg.style.transform = "scale(.82)"
        }
        const dot = document.createElement("div")
        dot.className = "ask-form-press"
        dot.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;z-index:2147483646;pointer-events:none;background:rgba(92,200,255,.45);border:3px solid #5cc8ff`
        const ring = document.createElement("div")
        ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;z-index:2147483646;pointer-events:none;border:5px solid #5cc8ff;transition:transform 650ms ease-out,opacity 650ms ease-out;transform:scale(.2);opacity:1`
        document.body.append(dot, ring)
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1)"
          ring.style.opacity = "0"
        })
        setTimeout(() => ring.remove(), 900)
        if (!keep) {
          setTimeout(() => {
            dot.remove()
            if (svg !== null) {
              svg.style.transform = ""
            }
          }, 260)
        }
      },
      { ...point, keep: hold }
    )
    this.recorder()?.sound("click")
  }

  private async release(): Promise<void> {
    await this.page.evaluate(() => {
      document.querySelectorAll(".ask-form-press").forEach((dot) => dot.remove())
      const svg = document.querySelector<SVGElement>("#ask-form-pointer svg")
      if (svg !== null) {
        svg.style.transform = ""
      }
    })
  }

  private place(point: { readonly x: number; readonly y: number }, smooth: boolean): Promise<void> {
    return this.page.evaluate(
      ({ x, y, ease }) => {
        const pointer = document.querySelector<HTMLElement>("#ask-form-pointer")
        if (pointer !== null) {
          pointer.style.transition = ease ? "" : "none"
          pointer.style.transform = `translate(${x - 8}px, ${y - 4}px)`
        }
        document.querySelectorAll<HTMLElement>(".ask-form-press").forEach((dot) => {
          dot.style.left = `${x}px`
          dot.style.top = `${y}px`
        })
      },
      { ...point, ease: smooth }
    )
  }

  async click(target: Locator): Promise<void> {
    await this.moveTo(target)
    await this.press(await center(target), false)
    await sleep(150)
    await target.click()
  }

  async drag(slider: Locator, from: number, to: number): Promise<void> {
    const box = await slider.boundingBox()
    if (box === null) {
      throw new Error("the slider is not visible")
    }
    const thumb = box.height
    const at = (ratio: number) => ({ x: box.x + thumb / 2 + ratio * (box.width - thumb), y: box.y + box.height / 2 })
    const start = at(from)
    await this.place(start, true)
    await sleep(800)
    await this.page.mouse.move(start.x, start.y)
    await this.press(start, true)
    await this.page.mouse.down()
    await sleep(250)
    const steps = 24
    for (let index = 1; index <= steps; index++) {
      const point = at(from + ((to - from) * index) / steps)
      await this.page.mouse.move(point.x, point.y)
      await this.place(point, false)
      await sleep(45)
    }
    await sleep(250)
    await this.page.mouse.up()
    await this.release()
  }
}

export const typeNumber = async (pointer: Pointer, recorder: Recorder, frame: Frame, label: string, value: string): Promise<void> => {
  const input = frame.getByRole("spinbutton", { name: label })
  await pointer.click(input)
  await input.press("ControlOrMeta+a")
  for (const character of value) {
    await input.pressSequentially(character)
    recorder.sound("key")
    await sleep(200)
  }
  await input.evaluate((element) => {
    element.dispatchEvent(new Event("change", { bubbles: true }))
    ;(element as HTMLElement).blur()
  })
}
