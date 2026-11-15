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

interface Point {
  readonly x: number
  readonly y: number
}

const center = async (target: Locator): Promise<Point> => {
  await target.waitFor()
  const box = await target.boundingBox()
  if (box === null) {
    throw new Error("the target is not visible")
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export interface PointerLook {
  readonly host: string
  readonly size: number
}

interface PointerApi {
  place(x: number, y: number, ease: boolean): void
  press(x: number, y: number, keep: boolean): void
}

const plainLook: PointerLook = { host: "body", size: 30 }

export class Pointer {
  private readonly page: Page
  private readonly recorder: () => Recorder | undefined
  private readonly look: PointerLook

  constructor(page: Page, recorder: () => Recorder | undefined, look?: PointerLook) {
    this.page = page
    this.recorder = recorder
    this.look = look ?? plainLook
  }

  async install(start: Point): Promise<void> {
    await this.page.evaluate(
      ({ d, start: origin, host, size }) => {
        const layer = document.querySelector<HTMLElement>(host) ?? document.body
        const fixed = layer === document.body
        const position = fixed ? "fixed" : "absolute"
        const local = (x: number, y: number) => {
          if (fixed) {
            return { x, y }
          }
          const rect = layer.getBoundingClientRect()
          const k = rect.width / layer.offsetWidth
          return { x: (x - rect.left) / k, y: (y - rect.top) / k }
        }
        const tip = { x: size / 3, y: size / 6 }
        const move = "transform 600ms cubic-bezier(.4,0,.2,1)"
        const namespace = "http://www.w3.org/2000/svg"
        const pointer = document.createElement("div")
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
        pointer.style.cssText = `position:${position};left:0;top:0;width:${size}px;height:${size}px;z-index:2147483647;pointer-events:none;transition:${move};filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));transform:translate(${origin.x - tip.x}px,${origin.y - tip.y}px)`
        svg.style.cssText = `width:${size}px;height:${size}px;pointer-events:none;transform-origin:${tip.x}px ${tip.y}px;transition:transform 120ms ease-out`
        layer.append(pointer)
        const dots: Array<HTMLElement> = []
        const circle = (point: { x: number; y: number }, diameter: number, css: string) => {
          const element = document.createElement("div")
          element.style.cssText = `position:${position};left:${point.x}px;top:${point.y}px;width:${diameter}px;height:${diameter}px;margin:${-diameter / 2}px 0 0 ${-diameter / 2}px;border-radius:50%;z-index:2147483646;pointer-events:none;${css}`
          layer.append(element)
          return element
        }
        const unpress = () => {
          dots.splice(0).forEach((dot) => dot.remove())
          svg.style.transform = ""
        }
        const pointerApi: PointerApi = {
          place(x, y, ease) {
            const point = local(x, y)
            pointer.style.transition = ease ? move : "none"
            pointer.style.transform = `translate(${point.x - tip.x}px, ${point.y - tip.y}px)`
            dots.forEach((dot) => {
              dot.style.left = `${point.x}px`
              dot.style.top = `${point.y}px`
            })
          },
          press(x, y, keep) {
            const point = local(x, y)
            svg.style.transform = "scale(.82)"
            dots.push(circle(point, size * 0.8, "background:rgba(255,210,63,.45);border:3px solid #ffd23f"))
            const ring = circle(
              point,
              size * 2.4,
              "border:4px solid #ffd23f;transition:transform 650ms ease-out,opacity 650ms ease-out;transform:scale(.2);opacity:1"
            )
            requestAnimationFrame(() => {
              ring.style.transform = "scale(1)"
              ring.style.opacity = "0"
            })
            setTimeout(() => ring.remove(), 900)
            if (!keep) {
              setTimeout(unpress, 260)
            }
          }
        }
        ;(window as unknown as { askPointer: PointerApi }).askPointer = pointerApi
      },
      { d: pointerPath, start, ...this.look }
    )
  }

  private place(point: Point, ease: boolean): Promise<void> {
    return this.page.evaluate(({ x, y, smooth }) => (window as unknown as { askPointer: PointerApi }).askPointer.place(x, y, smooth), {
      ...point,
      smooth: ease
    })
  }

  private async press(point: Point, keep: boolean): Promise<void> {
    await this.page.evaluate(({ x, y, hold }) => (window as unknown as { askPointer: PointerApi }).askPointer.press(x, y, hold), {
      ...point,
      hold: keep
    })
    this.recorder()?.sound("click")
  }

  async pointAt(target: Locator): Promise<void> {
    await target.waitFor()
    const box = await target.boundingBox()
    if (box !== null) {
      await this.place(
        { x: box.x + Math.min(box.width * 0.85, box.width - 6), y: box.y + Math.min(box.height * 0.75, box.height - 4) },
        true
      )
    }
  }

  async click(target: Locator): Promise<void> {
    const point = await center(target)
    await this.place(point, true)
    await sleep(650)
    await this.press(point, false)
    await sleep(150)
    await this.page.mouse.click(point.x, point.y)
  }
}

export const typeNumber = async (pointer: Pointer, recorder: Recorder, frame: Frame, label: string, value: string): Promise<void> => {
  const input = frame.getByRole("spinbutton", { name: label })
  await pointer.click(input)
  await input.fill(value)
  recorder.sound("key")
  await sleep(300)
  await input.evaluate((element) => {
    element.dispatchEvent(new Event("change", { bubbles: true }))
    ;(element as HTMLElement).blur()
  })
}
