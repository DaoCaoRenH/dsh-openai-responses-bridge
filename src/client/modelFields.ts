import type { BridgeModelProfile } from '../types.ts'

/** A model row is the Bridge schema object, including Bridge-only capabilities. */
export type BridgeModelDraft = BridgeModelProfile

export type ModelValidationKey =
  | 'modelIdRequired'
  | 'modelIdDuplicate'
  | 'modelNameInvalid'
  | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'
  | 'modelInputInvalid'

export interface BridgeModelsValidationFailure {
  index: number
  key: ModelValidationKey
}
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/iu
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/** Parse the same compact K/M capacity notation used by the native editor. */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/** Format a stored capacity without changing the underlying token count. */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** Validate the model rows before the Bridge settings schema sees them. */
export function validateBridgeModels(
  value: readonly BridgeModelDraft[],
): BridgeModelsValidationFailure | undefined {
  const seen = new Set<string>()
  for (const [index, model] of value.entries()) {
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (id.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(id)) return { index, key: 'modelIdDuplicate' }
    seen.add(id)
    if (model.name !== undefined && (typeof model.name !== 'string' || model.name.trim().length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    if (model.contextWindow !== undefined
      && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    if (model.maxTokens !== undefined
      && (!Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
    if (model.input !== undefined && model.input.length === 0) {
      return { index, key: 'modelInputInvalid' }
    }
  }
  return undefined
}
