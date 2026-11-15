import { spawnSync } from "node:child_process"
import { readdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export type CueKind = "click" | "success"

export interface Cue {
  readonly at: number
  readonly kind: CueKind
}

export interface Arrangement {
  readonly duration: number
  readonly cues: ReadonlyArray<Cue>
}

const rate = 48_000

const samples: Readonly<Record<CueKind, ReadonlyArray<{ readonly file: string; readonly gain: number; readonly offset: number }>>> = {
  click: [{ file: "ui_click1.wav", gain: 0.05, offset: 0 }],
  success: [{ file: "confirmation_002.wav", gain: 0.055, offset: 0 }]
}

class Track {
  readonly left: Float32Array
  readonly right: Float32Array

  constructor(seconds: number) {
    this.left = new Float32Array(Math.ceil(seconds * rate))
    this.right = new Float32Array(Math.ceil(seconds * rate))
  }

  add(at: number, length: number, gain: number, pan: number, sample: (time: number) => number): void {
    const start = Math.max(0, Math.floor(at * rate))
    const end = Math.min(this.left.length, Math.floor((at + length) * rate))
    const left = gain * Math.cos(((pan + 1) * Math.PI) / 4)
    const right = gain * Math.sin(((pan + 1) * Math.PI) / 4)
    for (let index = start; index < end; index++) {
      const value = sample((index - start) / rate)
      this.left[index] = (this.left[index] ?? 0) + value * left
      this.right[index] = (this.right[index] ?? 0) + value * right
    }
  }
}

const decoded = new Map<string, Float32Array>()

const load = (file: string): Float32Array => {
  const cached = decoded.get(file)
  if (cached !== undefined) {
    return cached
  }
  const path = fileURLToPath(new URL(`sounds/${file}`, import.meta.url))
  const result = spawnSync(
    "ffmpeg",
    ["-loglevel", "error", "-i", path, "-af", "lowpass=f=2500", "-f", "f32le", "-ac", "1", "-ar", String(rate), "-"],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  if (result.status !== 0) {
    throw new Error(`decoding ${file} failed: ${result.stderr.toString()}`)
  }
  const pcm = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4)
  decoded.set(file, pcm)
  return pcm
}

const effects = (track: Track, cues: ReadonlyArray<Cue>): void => {
  const counts = new Map<CueKind, number>()
  for (const cue of cues) {
    const choices = samples[cue.kind]
    const count = counts.get(cue.kind) ?? 0
    counts.set(cue.kind, count + 1)
    const choice = choices[count % choices.length]
    if (choice === undefined) {
      continue
    }
    const pcm = load(choice.file)
    track.add(cue.at + choice.offset, pcm.length / rate, choice.gain, 0, (time) => pcm[Math.floor(time * rate)] ?? 0)
  }
}

const extensions = [".mp3", ".wav", ".ogg", ".m4a"]

const songFile = async (): Promise<string | null> => {
  const names = await readdir(fileURLToPath(new URL("music", import.meta.url))).catch((): Array<string> => [])
  const chosen = names.filter((name) => extensions.some((extension) => name.toLowerCase().endsWith(extension))).toSorted()[0]
  return chosen === undefined ? null : fileURLToPath(new URL(`music/${chosen}`, import.meta.url))
}

const song = (file: string): { readonly left: Float32Array; readonly right: Float32Array } => {
  const result = spawnSync(
    "ffmpeg",
    ["-loglevel", "error", "-i", file, "-vn", "-af", "loudnorm=I=-24:TP=-9:LRA=11", "-f", "f32le", "-ac", "2", "-ar", String(rate), "-"],
    { maxBuffer: 256 * 1024 * 1024 }
  )
  if (result.status !== 0) {
    throw new Error(`decoding ${file} failed: ${result.stderr.toString()}`)
  }
  const interleaved = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength / 4)
  const frames = Math.floor(interleaved.length / 2)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let index = 0; index < frames; index++) {
    left[index] = interleaved[index * 2] ?? 0
    right[index] = interleaved[index * 2 + 1] ?? 0
  }
  return { left, right }
}

const wav = (left: Float32Array, right: Float32Array): Buffer => {
  const frames = left.length
  const buffer = Buffer.alloc(44 + frames * 4)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + frames * 4, 4)
  buffer.write("WAVEfmt ", 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(frames * 4, 40)
  for (let index = 0; index < frames; index++) {
    buffer.writeInt16LE(Math.round((left[index] ?? 0) * 32_767), 44 + index * 4)
    buffer.writeInt16LE(Math.round((right[index] ?? 0) * 32_767), 46 + index * 4)
  }
  return buffer
}

const fillBackground = (background: Track, source: { readonly left: Float32Array; readonly right: Float32Array }): void => {
  if (source.left.length === 0) {
    return
  }
  for (let index = 0; index < background.left.length; index++) {
    const at = index % source.left.length
    background.left[index] = source.left[at] ?? 0
    background.right[index] = source.right[at] ?? 0
  }
}

export const renderAudio = async (arrangement: Arrangement, path: string): Promise<void> => {
  const background = new Track(arrangement.duration)
  const file = await songFile()
  if (file !== null) {
    fillBackground(background, song(file))
  }
  const foreground = new Track(arrangement.duration)
  effects(foreground, arrangement.cues)
  const left = new Float32Array(background.left.length)
  const right = new Float32Array(background.right.length)
  for (let index = 0; index < left.length; index++) {
    left[index] = Math.tanh(((background.left[index] ?? 0) * 0.5 + (foreground.left[index] ?? 0)) * 0.9)
    right[index] = Math.tanh(((background.right[index] ?? 0) * 0.5 + (foreground.right[index] ?? 0)) * 0.9)
  }
  let peak = 1e-6
  for (let index = 0; index < left.length; index++) {
    peak = Math.max(peak, Math.abs(left[index] ?? 0), Math.abs(right[index] ?? 0))
  }
  const scale = 0.89 / peak
  await writeFile(
    path,
    wav(
      left.map((value) => value * scale),
      right.map((value) => value * scale)
    )
  )
}
