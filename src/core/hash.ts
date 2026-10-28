const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item))
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .flatMap((key) => {
          const entry: unknown = (value as Record<string, unknown>)[key]
          return entry === undefined ? [] : [[key, canonicalize(entry)]]
        })
    )
  }
  return value
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value))

const fnv1a = (text: string, seed: number): string => {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.codePointAt(i) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export const stableHash = (value: unknown): string => {
  const text = canonicalJson(value)
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x9747b28c)
}
