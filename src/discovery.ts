/**
 * Model discovery for the Bridge settings card.
 *
 * The browser sends the endpoint and one-shot key for the draft that is still
 * being edited. Nothing is stored here; the returned rows are only candidates
 * for the client-side model picker. The route configuration is written later
 * through settings.mutate.
 */

import { attributionHeaders, INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'

const BRIDGE_DISCOVERY_API = 'openai-responses-bridge'
const GOOGLE_DISCOVERY_API = 'google-generative-ai'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

interface ListingEntry {
  id?: unknown
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function positiveInteger(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  }
  return undefined
}

function nonEmptyString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/models`
}

async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError => new LlmError(
    `${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`,
    'DISCOVERY_FAILED',
  )
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function readListing(body: unknown): LlmDiscoveredModel[] {
  const record = recordOf(body)
  const rawModels = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models) ? record.models : undefined
  if (rawModels === undefined) {
    throw new LlmError(
      'the endpoint model listing has no "data" or "models" array; enter the models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of rawModels) {
    const entry = recordOf(raw) as ListingEntry
    const id = nonEmptyString(entry.id)
    if (id === undefined) continue
    const name = nonEmptyString(entry.name, entry.display_name)
    const contextWindow = positiveInteger(entry.context_window, entry.context_length)
    const maxTokens = positiveInteger(entry.max_output_tokens, entry.max_tokens)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'the Bridge discovery API key is blank; enter a key or leave discovery unauthenticated'
      : 'the Bridge discovery API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * Ask one OpenAI-compatible third-party endpoint for its model directory.
 * The Bridge protocol is intentionally the only accepted wire face here; it
 * is not added to DSH's native pi-ai protocol union.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  storedApiKey?: () => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<readonly LlmDiscoveredModel[]> {
  if (request.baseURL === undefined || request.baseURL.trim().length === 0) {
    throw new LlmError('Bridge model discovery needs a non-empty baseURL', 'INVALID_DISCOVERY')
  }
  if (request.api !== undefined && request.api !== BRIDGE_DISCOVERY_API) {
    throw new LlmError(
      request.api === GOOGLE_DISCOVERY_API
        ? 'Google Generative AI model discovery is not supported by the Bridge /models probe; enter models manually'
        : `Bridge model discovery does not support protocol "${request.api}"`,
      'DISCOVERY_UNSUPPORTED',
    )
  }

  const url = listingUrl(request.baseURL.trim())
  const requestSignal = signal
  const supplied = request.apiKey ?? await storedApiKey?.()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        ...attributionHeaders(),
      },
      ...requestSignal === undefined ? {} : { signal: requestSignal },
    })
  } catch (error: unknown) {
    if (requestSignal?.aborted) throw new LlmError('Bridge model discovery was aborted', 'ABORTED', { cause: error })
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
      { status: response.status },
    )
  }

  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    if (requestSignal?.aborted) throw new LlmError('Bridge model discovery was aborted', 'ABORTED', { cause: error })
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body)
}
