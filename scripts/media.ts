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
const start = Math.max(0, (take.marks["typing"] ?? 0) - 0.6)
run("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-ss",
  start.toFixed(2),
  "-i",
  take.video,
  "-vf",
  "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a",
  join(root, "docs/images/demo.gif")
])
