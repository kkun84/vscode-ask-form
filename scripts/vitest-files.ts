import { isAbsolute, relative, sep } from "node:path"

export interface VitestProjectFiles {
  readonly configFile: string | false | undefined
  readonly setupFiles: ReadonlyArray<string>
  readonly globalSetup: string | ReadonlyArray<string> | undefined
}

const insideRoot = (path: string) =>
  path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path) && !path.split(sep).includes("node_modules")

export const vitestFiles = (root: string, projects: ReadonlyArray<VitestProjectFiles>): ReadonlyArray<string> => {
  const files = new Set<string>()
  for (const project of projects) {
    const candidates = [...(project.configFile ? [project.configFile] : []), ...project.setupFiles, ...[project.globalSetup ?? []].flat()]
    for (const file of candidates.filter((candidate) => isAbsolute(candidate))) {
      const path = relative(root, file)
      if (insideRoot(path)) {
        files.add(path.split(sep).join("/"))
      }
    }
  }
  return [...files].toSorted()
}
