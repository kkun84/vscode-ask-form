import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export type CueKind = "whoosh" | "key" | "click" | "pop" | "success" | "chime" | "impact"

export interface Cue {
  readonly at: number
  readonly kind: CueKind
}

export interface Arrangement {
  readonly duration: number
  readonly beatsFrom: number
  readonly beatsUntil: number
  readonly cues: ReadonlyArray<Cue>
}

const rate = 48_000
const tempo = 140
const beat = 60 / tempo
const bar = beat * 4

const chords: ReadonlyArray<ReadonlyArray<number>> = [
  [62, 66, 69, 74],
  [57, 61, 64, 69],
  [59, 62, 66, 71],
  [55, 59, 62, 67]
]

const samples: Readonly<Record<CueKind, ReadonlyArray<{ readonly file: string; readonly gain: number; readonly offset: number }>>> = {
  key: [
    { file: "click_002.wav", gain: 0.03, offset: 0 },
    { file: "click_003.wav", gain: 0.03, offset: 0 },
    { file: "click_005.wav", gain: 0.03, offset: 0 }
  ],
  click: [{ file: "ui_click1.wav", gain: 0.1, offset: 0 }],
  whoosh: [{ file: "maximize_004.wav", gain: 0.08, offset: -0.15 }],
  pop: [{ file: "drop_004.wav", gain: 0.11, offset: 0 }],
  success: [{ file: "confirmation_002.wav", gain: 0.11, offset: 0 }],
  chime: [{ file: "confirmation_004.wav", gain: 0.09, offset: 0 }],
  impact: [{ file: "bong_001.wav", gain: 0.16, offset: 0 }]
}

const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12)

const random = (() => {
  let seed = 20_261_031
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return seed / 4_294_967_296 - 0.5
  }
})()

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

const pump = (time: number) => 0.45 + 0.55 * Math.min(1, ((time % beat) / beat) * 2.2)

const pad = (track: Track, at: number, note: number, groove: boolean): void => {
  const base = frequency(note)
  track.add(at, bar + 0.4, 0.045, random() * 0.7, (time) => {
    const swell = Math.min(1, time / 0.05) * (time > bar ? Math.exp(-(time - bar) / 0.15) : 1)
    const tone =
      Math.sin(2 * Math.PI * base * time) +
      0.5 * Math.sin(2 * Math.PI * base * 1.004 * time) +
      0.5 * Math.sin(2 * Math.PI * base * 0.996 * time) +
      0.25 * Math.sin(4 * Math.PI * base * time) +
      0.12 * Math.sin(6 * Math.PI * base * time)
    return swell * tone * (groove ? pump(time) : 1)
  })
}

const pluck = (track: Track, at: number, note: number, pan: number): void => {
  const base = frequency(note)
  track.add(at, 0.5, 0.06, pan, (time) => {
    const tone =
      Math.sin(2 * Math.PI * base * time) + 0.5 * Math.sin(4 * Math.PI * base * time) + 0.25 * Math.sin(6 * Math.PI * base * time)
    return Math.min(1, time / 0.003) * Math.exp(-time / 0.14) * tone
  })
}

const bass = (track: Track, at: number, note: number): void => {
  const base = frequency(note)
  track.add(at, beat / 2, 0.22, 0, (time) => {
    const tone = Math.sin(2 * Math.PI * base * time) + 0.3 * Math.sin(4 * Math.PI * base * time)
    return Math.min(1, time / 0.005) * Math.exp(-time / 0.18) * tone
  })
}

const kick = (track: Track, at: number): void => {
  let phase = 0
  track.add(at, 0.35, 0.6, 0, (time) => {
    phase += (2 * Math.PI * (50 + 110 * Math.exp(-time / 0.03))) / rate
    return Math.exp(-time / 0.13) * Math.sin(phase)
  })
}

const noise = (track: Track, at: number, length: number, gain: number, pan: number, decay: number, brightness: number): void => {
  let previous = 0
  let smooth = 0
  track.add(at, length, gain, pan, (time) => {
    const white = random()
    smooth += (white - smooth) * 0.3
    const high = white - previous
    previous = white
    return Math.exp(-time / decay) * (high * brightness + smooth * (1 - brightness))
  })
}

const arpeggio = [0, 1, 2, 3, 2, 1, 2, 3]

const harmony = (track: Track, at: number, chord: ReadonlyArray<number>, groove: boolean): void => {
  for (const note of chord) {
    pad(track, at, note - 12, groove)
  }
  for (const [step, index] of arpeggio.entries()) {
    pluck(track, at + (step * beat) / 2, (chord[index] ?? 74) + 12, step % 2 === 0 ? -0.3 : 0.3)
  }
}

const rhythm = (track: Track, at: number, root: number): void => {
  for (let step = 0; step < 4; step++) {
    kick(track, at + step * beat)
    bass(track, at + step * beat + beat / 2, root)
    noise(track, at + step * beat + beat / 2, 0.12, 0.05, 0.35, 0.04, 0.55)
  }
  for (const step of [1, 3]) {
    noise(track, at + step * beat, 0.25, 0.13, 0, 0.07, 0.35)
  }
}

const music = (track: Track, arrangement: Arrangement): void => {
  const bars = Math.ceil(arrangement.duration / bar)
  for (let index = 0; index < bars; index++) {
    const chord = chords[index % chords.length] ?? []
    const at = index * bar
    const groove = at >= arrangement.beatsFrom - bar / 2 && at < arrangement.beatsUntil
    harmony(track, at, chord, groove)
    if (groove) {
      rhythm(track, at, (chord[0] ?? 62) - 24)
    }
  }
}

const reverb = (track: Track, mix: number): void => {
  const delays = [1557, 1617, 1491, 1422].map((value) => Math.round((value * rate) / 44_100))
  for (const channel of [track.left, track.right]) {
    const dry = Float32Array.from(channel)
    const wet = new Float32Array(channel.length)
    for (const delay of delays) {
      const buffer = new Float32Array(delay)
      let cursor = 0
      for (let index = 0; index < dry.length; index++) {
        const out = buffer[cursor] ?? 0
        buffer[cursor] = (dry[index] ?? 0) + out * 0.72
        cursor = (cursor + 1) % delay
        wet[index] = (wet[index] ?? 0) + out / delays.length
      }
    }
    for (let index = 0; index < channel.length; index++) {
      channel[index] = (dry[index] ?? 0) + (wet[index] ?? 0) * mix
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
  const result = spawnSync("ffmpeg", ["-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", String(rate), "-"], {
    maxBuffer: 64 * 1024 * 1024
  })
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

export const renderAudio = async (arrangement: Arrangement, path: string): Promise<void> => {
  const background = new Track(arrangement.duration)
  music(background, arrangement)
  reverb(background, 0.25)
  const foreground = new Track(arrangement.duration)
  effects(foreground, arrangement.cues)
  const left = new Float32Array(background.left.length)
  const right = new Float32Array(background.right.length)
  const fadeOut = 2
  for (let index = 0; index < left.length; index++) {
    const time = index / rate
    const fade = Math.min(1, time / 0.3, (arrangement.duration - time) / fadeOut)
    left[index] = Math.tanh(((background.left[index] ?? 0) * 0.5 * fade + (foreground.left[index] ?? 0)) * 0.9)
    right[index] = Math.tanh(((background.right[index] ?? 0) * 0.5 * fade + (foreground.right[index] ?? 0)) * 0.9)
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
