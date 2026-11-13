import assert from "node:assert/strict"
import { Result } from "effect"
import type { CompiledForm } from "../../src/core/form.ts"
import { compile } from "../../src/core/validate.ts"

export const compiled = (input: unknown): CompiledForm => {
  const result = compile(input)
  assert.ok(Result.isSuccess(result), Result.isFailure(result) ? result.failure.join("\n") : "")
  return result.success
}

export const problems = (input: unknown): ReadonlyArray<string> => {
  const result = compile(input)
  assert.ok(Result.isFailure(result), "expected the spec to be rejected")
  return result.failure
}
