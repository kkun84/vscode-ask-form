import { appendFile } from "node:fs/promises"

export const writeOutput = async (output: string) => {
  const destination = process.env["GITHUB_OUTPUT"]
  if (destination === undefined) {
    process.stdout.write(output)
  } else {
    await appendFile(destination, output)
  }
}
