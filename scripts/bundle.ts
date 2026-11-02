import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { rolldown } from "rolldown"

export interface BundleOptions {
  readonly input: string
  readonly platform: "node" | "browser"
  readonly format: "cjs" | "esm" | "iife"
  readonly minify?: boolean
  readonly define?: Readonly<Record<string, string>>
}

export interface Bundled {
  readonly code: string
  readonly modules: ReadonlyArray<string>
}

const root = fileURLToPath(new URL("..", import.meta.url))

export const bundle = async (options: BundleOptions): Promise<Bundled> => {
  const build = await rolldown({
    input: options.input,
    platform: options.platform,
    external: ["vscode"],
    logLevel: "warn",
    transform: { target: options.platform === "node" ? "node20" : "es2022", define: { ...options.define } }
  })
  try {
    const { output } = await build.generate({
      format: options.format,
      minify: options.minify ?? false,
      comments: { legal: false },
      codeSplitting: false
    })
    const [chunk] = output
    return {
      code: chunk.code,
      modules: Object.keys(chunk.modules)
        .filter((id) => !id.startsWith("\0"))
        .map((id) => relative(root, id))
    }
  } finally {
    await build.close()
  }
}
