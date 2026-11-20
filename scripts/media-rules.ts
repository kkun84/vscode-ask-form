const sources = [
  /^src\/ui\//,
  /^src\/extension\//,
  /^src\/core\/messages\.ts$/,
  /^test\/acceptance\/(media|stage|stage-content)\.ts$/,
  /^test\/fixtures\/todo\.ts$/,
  /^scripts\/pv\.ts$/
]

const outputs = [/^docs\/images\//, /^docs\/media\//]

export const checkMedia = (changed: ReadonlyArray<string>): ReadonlyArray<string> => {
  const touched = changed.filter((file) => sources.some((source) => source.test(file)))
  if (touched.length === 0 || changed.some((file) => outputs.some((output) => output.test(file)))) {
    return []
  }
  return [
    `Re-capture docs/images and docs/media with pnpm media, or label the pull request no-media if nothing visible changed. Changed: ${touched.join(", ")}`
  ]
}
