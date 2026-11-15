import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { buildDriver } from "../test/acceptance/driver-build.ts"
import { captureMedia } from "../test/acceptance/media.ts"
import { run } from "../test/acceptance/recording.ts"
import { captureStage } from "../test/acceptance/stage.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const work = join(root, "test-results/media")
const only = process.argv[2]

if (only !== "stage") {
  const driver = join(root, "out/e2e-driver")
  const executable = process.env["VSCODE_ELECTRON"]
  const cli = process.env["VSCODE_EXECUTABLE"]
  if (executable === undefined || cli === undefined) {
    throw new Error("VSCODE_ELECTRON is not set. Run inside `nix develop .#acceptance`.")
  }
  await buildDriver(root, driver)
  await captureMedia({ executable, cli, extension: join(root, "out/extension"), driver, images: join(root, "docs/images"), work })
}

const take = await captureStage(work)
const choose = take.marks["choose"]
const chosen = take.marks["chosen"]
if (choose === undefined || chosen === undefined) {
  throw new Error("the take is missing the choose or chosen mark")
}
const start = choose + 0.4
const end = chosen
run("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-ss",
  start.toFixed(2),
  "-t",
  (end - start).toFixed(2),
  "-i",
  take.video,
  "-vf",
  "fps=15,scale=720:-1:flags=lanczos",
  "-c:v",
  "libwebp_anim",
  "-loop",
  "0",
  "-lossless",
  "0",
  "-quality",
  "80",
  "-compression_level",
  "6",
  "-an",
  join(root, "docs/images/demo.webp")
])
