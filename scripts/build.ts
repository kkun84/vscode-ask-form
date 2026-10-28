import { mkdir, readFile, writeFile } from "node:fs/promises"
import { build, type BuildOptions } from "esbuild"

const root = new URL("..", import.meta.url)
const path = (relative: string) => new URL(relative, root).pathname

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
  entryPoints: [path("src/ui/main.ts")],
  platform: "browser",
  format: "esm",
  target: "es2022",
  write: false
})
const script = (ui.outputFiles[0]?.text ?? "").replaceAll("</script", "<\\/script")
const style = await build({ ...common, entryPoints: [path("src/ui/styles.css")], loader: { ".css": "css" }, write: false })
const template = await readFile(path("src/ui/index.html"), "utf8")
const html = template
  .replace("/*STYLE*/", () => style.outputFiles[0]?.text ?? "")
  .replace("/*SCRIPT*/", () => script)

await mkdir(path("dist"), { recursive: true })
await writeFile(path("dist/form.html"), html)

const define = {
  COPILOT_FORMS_HTML: JSON.stringify(html),
  COPILOT_FORMS_VERSION: JSON.stringify(pkg.version)
}

await build({
  ...common,
  entryPoints: [path("src/extension/node/main.ts")],
  outfile: path("dist/node/extension.cjs"),
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  define
})

await build({
  ...common,
  entryPoints: [path("src/extension/web/main.ts")],
  outfile: path("dist/web/extension.js"),
  platform: "browser",
  format: "cjs",
  target: "es2022",
  external: ["vscode"],
  define
})
