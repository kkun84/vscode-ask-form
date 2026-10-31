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
        pointer.style.cssText = `position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform 700ms cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));transform:translate(${x}px,${y}px)`
        svg.style.cssText = "width:26px;height:26px;pointer-events:none"
        document.body.append(pointer)
      },
      { d: pointerPath, ...start }
    )
  }

  async moveTo(target: Locator): Promise<void> {
    await this.page.evaluate(
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

  async click(target: Locator): Promise<void> {
    await this.moveTo(target)
    await this.page.evaluate(
      ({ x, y }) => {
        const ring = document.createElement("div")
        ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;border:3px solid #4fc3ff;transition:transform 600ms ease-out,opacity 600ms ease-out;transform:scale(.3);opacity:1`
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1.4)"
          ring.style.opacity = "0"
        })
        document.body.append(ring)
        setTimeout(() => ring.remove(), 800)
      },
      await center(target)
    )
    this.recorder()?.sound("click")
    await target.click()
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
  await frame.locator("h1").click()
}
