import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { mutatorSettings, withMutationVitest } from "./mutation-vitest.ts"
import { vitestFiles } from "./vitest-files.ts"

const root = process.cwd()

await withMutationVitest(await mutatorSettings(root), (vitest) => {
  const files = vitestFiles(
    root,
    vitest.projects.map((project) => ({
      configFile: project.vite.config.configFile,
      setupFiles: project.config.setupFiles,
      globalSetup: project.config.globalSetup
    }))
  ).filter((file) => existsSync(resolve(root, file)))
  return files.map((file) => `${file}\n`).join("")
})
