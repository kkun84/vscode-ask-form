import { fileURLToPath } from "node:url"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { bundle } from "./bundle.ts"

const root = new URL("..", import.meta.url)
const path = (relative: string) => fileURLToPath(new URL(relative, root))

const pkg = JSON.parse(await readFile(path("package.json"), "utf8")) as { readonly version: string }

const ui = await bundle({ input: path("src/ui/main.ts"), platform: "browser", format: "esm", minify: true })
const script = ui.code.replaceAll("</script", "<\\/script")
const style = await readFile(path("src/ui/styles.css"), "utf8")
const template = await readFile(path("src/ui/index.html"), "utf8")
const html = template.replace("__STYLE__", () => style).replace("__SCRIPT__", () => script)

await mkdir(path("dist"), { recursive: true })
await writeFile(path("dist/form.html"), html)

const define = {
  ASK_FORM_HTML: JSON.stringify(html),
  ASK_FORM_VERSION: JSON.stringify(pkg.version)
}

const node = await bundle({ input: path("src/extension/node/main.ts"), platform: "node", format: "cjs", minify: true, define })
const web = await bundle({ input: path("src/extension/web/main.ts"), platform: "browser", format: "cjs", minify: true, define })

await mkdir(path("dist/node"), { recursive: true })
await mkdir(path("dist/web"), { recursive: true })
await writeFile(path("dist/node/extension.cjs"), node.code)
await writeFile(path("dist/web/extension.js"), web.code)
await writeFile(
  path("dist/meta.json"),
  JSON.stringify({ inputs: Object.fromEntries([...ui.modules, ...node.modules, ...web.modules].map((id) => [id, {}])) })
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
