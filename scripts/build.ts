import { fileURLToPath } from "node:url"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { build, type BuildOptions } from "esbuild"

const root = new URL("..", import.meta.url)
const path = (relative: string) => fileURLToPath(new URL(relative, root))

const pkg = JSON.parse(await readFile(path("package.json"), "utf8")) as { readonly version: string }

const common: BuildOptions = {
  bundle: true,
  minify: true,
  legalComments: "none",
  treeShaking: true,
  logLevel: "warning"
}

const ui = await build({
  ...common,
  metafile: true,
  entryPoints: [path("src/ui/main.ts")],
  platform: "browser",
  format: "esm",
  target: "es2022",
  write: false
})
const script = (ui.outputFiles[0]?.text ?? "").replaceAll("</script", "<\\/script")
const style = await build({ ...common, entryPoints: [path("src/ui/styles.css")], loader: { ".css": "css" }, write: false })
const template = await readFile(path("src/ui/index.html"), "utf8")
const html = template.replace("__STYLE__", () => style.outputFiles[0]?.text ?? "").replace("__SCRIPT__", () => script)

await mkdir(path("dist"), { recursive: true })
await writeFile(path("dist/form.html"), html)

const define = {
  ASK_FORM_HTML: JSON.stringify(html),
  ASK_FORM_VERSION: JSON.stringify(pkg.version)
}

const node = await build({
  ...common,
  metafile: true,
  entryPoints: [path("src/extension/node/main.ts")],
  outfile: path("dist/node/extension.cjs"),
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  define
})

const web = await build({
  ...common,
  metafile: true,
  entryPoints: [path("src/extension/web/main.ts")],
  outfile: path("dist/web/extension.js"),
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["vscode"],
  define
})

await writeFile(
  path("dist/meta.json"),
  JSON.stringify({ inputs: { ...ui.metafile.inputs, ...node.metafile.inputs, ...web.metafile.inputs } })
)

const stage = path("out/extension/")
await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
const {
  type: _type,
  scripts: _scripts,
  devDependencies: _dev,
  dependencies: _deps,
  packageManager: _pm,
  ...manifest
} = JSON.parse(await readFile(path("package.json"), "utf8")) as Record<string, unknown>
await writeFile(
  join(stage, "package.json"),
  `${JSON.stringify({ ...manifest, files: ["dist/**", "LICENSE", "CHANGELOG.md"] }, undefined, 2)}\n`
)
await Promise.all([
  cp(path("dist/node"), join(stage, "dist/node"), { recursive: true }),
  cp(path("dist/web"), join(stage, "dist/web"), { recursive: true }),
  ...["README.md", "LICENSE", "CHANGELOG.md"].map((file) => cp(path(file), join(stage, file)))
])
