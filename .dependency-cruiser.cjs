const builtin = "^(node:|(assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|stream|url|util|worker_threads|zlib)$)"
const pureCore = "^src/core/(expression|form|hash|messages)\\.ts$"
const effect = ["^node_modules/effect/", "^node_modules/\\.pnpm/effect@"]
const runtime = { dependencyTypesNot: ["type-only"] }

module.exports = {
  forbidden: [
    {
      name: "ARCH-CYCLE-001",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "ARCH-LAYER-001",
      severity: "error",
      from: { path: "^src/core/" },
      to: { pathNot: ["^src/core/", ...effect] }
    },
    {
      name: "ARCH-LAYER-002",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { pathNot: ["^src/ui/", pureCore, "^src/core/spec\\.ts$"] }
    },
    {
      name: "ARCH-LAYER-002",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/core/(spec|validate|appHost)\\.ts$", ...runtime }
    },
    {
      name: "ARCH-LAYER-003",
      severity: "error",
      from: { path: "^src/mcp/" },
      to: { path: ["^src/(ui|extension)/", "^vscode$"] }
    },
    {
      name: "ARCH-LAYER-004",
      severity: "error",
      from: { path: "^src/extension/(web|shared)/" },
      to: { path: ["^src/mcp/", builtin] }
    },
    {
      name: "ARCH-LAYER-005",
      severity: "error",
      from: { path: "^src/extension/node/" },
      to: { path: "^src/extension/web/" }
    },
    {
      name: "ARCH-LAYER-005",
      severity: "error",
      from: { path: "^src/extension/web/" },
      to: { path: "^src/extension/node/" }
    },
    {
      name: "ARCH-LAYER-006",
      severity: "error",
      from: { path: pureCore },
      to: { pathNot: pureCore, ...runtime }
    },
    {
      name: "ARCH-EFFECT-001",
      severity: "error",
      from: { path: "^src/mcp/ports\\.ts$" },
      to: { pathNot: [...effect, pureCore] }
    },
    {
      name: "ARCH-EFFECT-002",
      severity: "error",
      from: { path: "^src/mcp/(server|pending|schema)\\.ts$" },
      to: { path: [builtin, "^src/mcp/http\\.ts$"] }
    },
    {
      name: "ARCH-EFFECT-003",
      severity: "error",
      from: { pathNot: ["^src/extension/node/", "^test/"] },
      to: { path: "^src/mcp/http\\.ts$" }
    },
    {
      name: "ARCH-DEPS-001",
      severity: "error",
      from: { path: "^src/" },
      to: { dependencyTypes: ["npm-dev", "npm-optional", "npm-peer", "npm-no-pkg", "npm-unknown"] }
    },
    {
      name: "ARCH-DEPS-001",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^(test|scripts)/" }
    },
    {
      name: "ARCH-DEPS-001",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^vscode$" }
    }
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"]
    },
    builtInModules: { add: ["vscode"] }
  }
}
