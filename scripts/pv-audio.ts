import { writeFile } from "node:fs/promises"

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
const tempo = 100
const beat = 60 / tempo
const bar = beat * 4

const chords: ReadonlyArray<ReadonlyArray<number>> = [
  [53, 57, 60, 64],
  [55, 59, 62, 64],
  [52, 55, 59, 62],
  [57, 60, 64, 67]
]

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

const envelope = (time: number, attack: number, decay: number) => (time < attack ? time / attack : Math.exp(-(time - attack) / decay))

const pad = (track: Track, at: number, length: number, note: number): void => {
  const base = frequency(note)
  track.add(at, length + 1, 0.05, random() * 0.6, (time) => {
    const swell = Math.min(1, time / 0.6) * (time > length ? Math.exp(-(time - length) / 0.4) : 1)
    const tone =
      Math.sin(2 * Math.PI * base * time) +
      0.6 * Math.sin(2 * Math.PI * base * 1.003 * time) +
      0.6 * Math.sin(2 * Math.PI * base * 0.997 * time) +
      0.15 * Math.sin(4 * Math.PI * base * time)
    return swell * tone
  })
}

const pluck = (track: Track, at: number, note: number, pan: number, gain: number): void => {
  const base = frequency(note)
  track.add(at, 1.2, gain, pan, (time) => {
    const tone = Math.sin(2 * Math.PI * base * time) + 0.3 * Math.sin(6 * Math.PI * base * time) * Math.exp(-time / 0.08)
    return envelope(time, 0.004, 0.32) * tone
  })
}

const bass = (track: Track, at: number, length: number, note: number): void => {
  const base = frequency(note)
  track.add(at, length, 0.2, 0, (time) => {
    const tone = Math.sin(2 * Math.PI * base * time) + 0.25 * Math.sin(4 * Math.PI * base * time)
    return Math.min(1, time / 0.01) * Math.exp(-time / 0.9) * tone
  })
}

const kick = (track: Track, at: number): void => {
  let phase = 0
  track.add(at, 0.45, 0.55, 0, (time) => {
    phase += (2 * Math.PI * (45 + 90 * Math.exp(-time / 0.035))) / rate
    return Math.exp(-time / 0.16) * Math.sin(phase)
  })
}

const noise = (track: Track, at: number, length: number, gain: number, pan: number, decay: number, brightness: number): void => {
  let previous = 0
  let smooth = 0
  track.add(at, length, gain, pan, (time) => {
    const white = random()
    smooth += (white - smooth) * brightness
    const high = white - previous
    previous = white
    return Math.exp(-time / decay) * (high * brightness + smooth * (1 - brightness))
  })
}

const arpeggio = [0, 2, 1, 3, 2, 1, 3, 2]

const harmony = (track: Track, at: number, chord: ReadonlyArray<number>, groove: boolean): void => {
  for (const note of chord) {
    pad(track, at, bar, note - 12)
  }
  for (const [step, index] of arpeggio.entries()) {
    pluck(track, at + (step * beat) / 2, (chord[index] ?? 60) + 12, step % 2 === 0 ? -0.35 : 0.35, groove ? 0.07 : 0.05)
  }
}

const rhythm = (track: Track, at: number, root: number): void => {
  bass(track, at, beat * 2, root)
  bass(track, at + beat * 2, beat * 2, root)
  for (const step of [0, 2]) {
    kick(track, at + step * beat)
  }
  for (const step of [1, 3]) {
    noise(track, at + step * beat, 0.3, 0.12, 0, 0.08, 0.3)
  }
  for (let step = 0; step < 8; step++) {
    noise(track, at + (step * beat) / 2 + beat / 4, 0.08, 0.035, 0.4, 0.015, 0.6)
  }
}

const music = (track: Track, arrangement: Arrangement): void => {
  const bars = Math.ceil(arrangement.duration / bar)
  for (let index = 0; index < bars; index++) {
    const chord = chords[index % chords.length] ?? []
    const at = index * bar
    const groove = at >= arrangement.beatsFrom && at < arrangement.beatsUntil
    harmony(track, at, chord, groove)
    if (groove) {
      rhythm(track, at, (chord[0] ?? 48) - 24)
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
        buffer[cursor] = (dry[index] ?? 0) + out * 0.78
        cursor = (cursor + 1) % delay
        wet[index] = (wet[index] ?? 0) + out / delays.length
      }
    }
    for (let index = 0; index < channel.length; index++) {
      channel[index] = (dry[index] ?? 0) + (wet[index] ?? 0) * mix
    }
  }
}

const bell = (track: Track, at: number, note: number, gain: number, pan: number): void => {
  const base = frequency(note)
  track.add(at, 1.6, gain, pan, (time) => {
    const tone = Math.sin(2 * Math.PI * base * time) + 0.4 * Math.sin(2 * Math.PI * base * 2.76 * time) * Math.exp(-time / 0.2)
    return envelope(time, 0.003, 0.5) * tone
  })
}

const whoosh = (track: Track, at: number): void => {
  let smooth = 0
  track.add(at, 0.6, 0.16, 0, (time) => {
    const sweep = Math.sin((Math.PI * time) / 0.6)
    smooth += (random() - smooth) * (0.01 + 0.1 * sweep)
    return sweep * sweep * smooth * 3
  })
}

const effects = (track: Track, cues: ReadonlyArray<Cue>): void => {
  for (const cue of cues) {
    switch (cue.kind) {
      case "whoosh":
        whoosh(track, cue.at - 0.3)
        break
      case "key":
        noise(track, cue.at, 0.03, 0.16, 0.15 + random() * 0.2, 0.005, 0.25)
        break
      case "click":
        noise(track, cue.at, 0.04, 0.3, 0, 0.004, 0.45)
        bell(track, cue.at, 96, 0.06, 0)
        break
      case "pop":
        bell(track, cue.at, 88, 0.16, -0.2)
        bell(track, cue.at + 0.09, 95, 0.14, 0.2)
        break
      case "success":
        for (const [index, note] of [84, 88, 91, 96].entries()) {
          bell(track, cue.at + index * 0.075, note, 0.13, (index - 1.5) * 0.25)
        }
        break
      case "chime":
        bell(track, cue.at, 91, 0.12, -0.1)
        bell(track, cue.at + 0.11, 96, 0.1, 0.1)
        break
      case "impact":
        track.add(cue.at, 2, 0.5, 0, (time) => Math.exp(-time / 0.6) * Math.sin(2 * Math.PI * (38 + 30 * Math.exp(-time / 0.08)) * time))
        bell(track, cue.at + 0.05, 84, 0.1, -0.3)
        bell(track, cue.at + 0.05, 91, 0.1, 0.3)
        break
    }
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
  reverb(background, 0.35)
  const foreground = new Track(arrangement.duration)
  effects(foreground, arrangement.cues)
  reverb(foreground, 0.15)
  const left = new Float32Array(background.left.length)
  const right = new Float32Array(background.right.length)
  const fadeOut = 2.5
  for (let index = 0; index < left.length; index++) {
    const time = index / rate
    const fade = Math.min(1, time / 0.8, (arrangement.duration - time) / fadeOut)
    left[index] = Math.tanh(((background.left[index] ?? 0) * 0.55 * fade + (foreground.left[index] ?? 0)) * 0.9)
    right[index] = Math.tanh(((background.right[index] ?? 0) * 0.55 * fade + (foreground.right[index] ?? 0)) * 0.9)
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
