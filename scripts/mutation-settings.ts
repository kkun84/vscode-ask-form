import { reviewSettings } from "./mutation-rerun.ts"
import { emit } from "./mutation-run.ts"
import { mutatorSettings } from "./mutation-vitest.ts"

emit(reviewSettings(await mutatorSettings(process.cwd())))
