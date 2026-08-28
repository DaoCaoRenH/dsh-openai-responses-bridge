import z from '@deepseek-ai/schemastery'
import { RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import {
  BRIDGE_API_PROTOCOLS,
  DEFAULT_BRIDGE_API,
  DEFAULT_REASONING_EFFORTS,
} from './types.ts'
import type {
  BridgeConfig,
  BridgeModelProfile,
  BridgeProviderProfile,
  HostedToolsConfig,
  OpenAIResponsesTool,
  ResponsesToolChoice,
} from './types.ts'

const modelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(['text', 'image'] as const)).default(['text']),
  reasoningEfforts: z.union([
    z.const(false),
    z.dict(z.union([z.string(), z.const(null)]), z.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)),
  // Schemastery's typed dict models every allowed key as required, while the
  // Bridge map intentionally omits `minimal`. Runtime validation still keeps
  // the allowed-key union above; this cast only expresses the partial default.
  ]).default(DEFAULT_REASONING_EFFORTS as unknown as Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>),
}) as unknown as z<BridgeModelProfile>

// Raw hosted objects are checked by assertServiceable after schema resolution.
// Schemastery does not expose an open-ended record constructor in this release.
const rawToolSchema: z<OpenAIResponsesTool> = z.any() as unknown as z<OpenAIResponsesTool>
const toolChoiceSchema: z<ResponsesToolChoice> = z.any() as unknown as z<ResponsesToolChoice>

const hostedToolsSchema: z<HostedToolsConfig> = z.object({
  // Hosted tools are opt-in for newly created Bridge routes. The settings
  // card writes this field explicitly as false so a route never silently
  // starts a billable remote tool call.
  enabled: z.boolean().default(false),
  definitions: z.array(rawToolSchema).default([{ type: 'web_search' }]),
  toolChoice: toolChoiceSchema,
  include: z.array(z.string()).default([]),
  // Retained for settings compatibility; citation presentation is native Pi/DSH
  // behavior and is not transformed by the Bridge runtime.
  sourcePresentation: z.union(['auto', 'inline-only', 'append'] as const).default('auto'),
  imageGeneration: z.object({
    enabled: z.boolean().default(false),
    outputBackend: z.const('dsh-attachment'),
    maxBytes: z.number().step(1).min(1),
  }),
})

const providerSchema: z<BridgeProviderProfile> = z.object({
  api: z.union(BRIDGE_API_PROTOCOLS).default(DEFAULT_BRIDGE_API),
  apiKeyEnv: z.string().required(),
  displayName: z.string(),
  baseURL: z.string().required(),
  models: z.array(modelSchema).default([]),
  reasoning: z.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const),
  headers: z.dict(z.string()),
  streamIdleTimeoutMs: z.number().step(1).min(1).default(300_000),
  retryPolicy: RetryPolicySchema,
  hostedTools: hostedToolsSchema,
})

/** Runtime schema consumed by the DSH settings service. */
export const Config: z<BridgeConfig> = z.object({
  providers: z.dict(providerSchema).default({}),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const EXECUTOR_DEPENDENT_TYPES = new Set([
  'computer',
  'computer_use_preview',
  'local_shell',
  'shell',
  'apply_patch',
  'custom',
])

const HOSTED_CALL_TYPES = new Set([
  'file_search',
  'web_search',
  'web_search_preview',
  'code_interpreter',
  'image_generation',
  'mcp',
  'tool_search',
  'namespace',
  'function',
])

function validateTool(route: string, tool: OpenAIResponsesTool): void {
  if (!isRecord(tool) || typeof tool.type !== 'string' || tool.type.trim().length === 0) {
    throw new Error(`llm-openai-responses-bridge: provider "${route}" has a hosted tool without a non-empty type`)
  }
  if (EXECUTOR_DEPENDENT_TYPES.has(tool.type)) {
    throw new Error(`llm-openai-responses-bridge: hosted tool type "${tool.type}" is disabled until DSH provides an executor and approval continuation`)
  }
  if (!HOSTED_CALL_TYPES.has(tool.type)) {
    throw new Error(`llm-openai-responses-bridge: hosted tool type "${tool.type}" is not enabled in V1`)
  }
  if (tool.type === 'file_search') {
    const stores = tool.vector_store_ids
    if (!Array.isArray(stores) || stores.length === 0 || stores.some(item => typeof item !== 'string' || item.length === 0)) {
      throw new Error(`llm-openai-responses-bridge: provider "${route}" file_search requires non-empty vector_store_ids`)
    }
  }
  if (tool.type === 'mcp') {
    for (const key of ['authorization', 'api_key', 'token', 'secret']) {
      if (key in tool) throw new Error(`llm-openai-responses-bridge: provider "${route}" must keep MCP credential "${key}" in DSH credentials, not settings`)
    }
  }
}

function validateToolChoice(route: string, value: ResponsesToolChoice | undefined): void {
  if (value === undefined || typeof value === 'string') return
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`llm-openai-responses-bridge: provider "${route}" toolChoice object must have a type`)
  }
}

/** Validate cross-field settings that a schema cannot express. */
export function assertServiceable(config: BridgeConfig): void {
  for (const [route, source] of Object.entries(config.providers ?? {})) {
    if (route.trim().length === 0 || /\s/u.test(route)) throw new Error(`llm-openai-responses-bridge: invalid provider route "${route}"`)
    const api = source.api ?? DEFAULT_BRIDGE_API
    if (!BRIDGE_API_PROTOCOLS.includes(api)) throw new Error(`llm-openai-responses-bridge: provider "${route}" names unsupported api "${String(source.api)}"`)
    if (typeof source.apiKeyEnv !== 'string' || source.apiKeyEnv.trim().length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" requires apiKeyEnv`)
    if (typeof source.baseURL !== 'string' || source.baseURL.trim().length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" requires baseURL`)
    let url: URL
    try {
      url = new URL(source.baseURL)
    } catch {
      throw new Error(`llm-openai-responses-bridge: provider "${route}" baseURL must be an absolute HTTP(S) URL`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`llm-openai-responses-bridge: provider "${route}" baseURL must use http or https`)
    const models = source.models ?? []
    if (models.length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" must declare at least one model`)
    const ids = new Set<string>()
    for (const model of models) {
      if (model.id.trim().length === 0 || ids.has(model.id)) throw new Error(`llm-openai-responses-bridge: provider "${route}" has a duplicate or empty model id`)
      ids.add(model.id)
      if ((model.input ?? ['text']).length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" must accept text or image`)
      if (model.contextWindow !== undefined && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" has invalid contextWindow`)
      if (model.maxTokens !== undefined && (!Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" has invalid maxTokens`)
    }
    const hosted = source.hostedTools
    if (api === 'google-generative-ai' && hosted?.enabled === true) {
      throw new Error(`llm-openai-responses-bridge: hostedTools is only supported for the openai-responses protocol; provider "${route}" uses google-generative-ai`)
    }
    const definitions = hosted?.enabled === true
      ? (hosted.definitions ?? [{ type: 'web_search' }])
      : []
    for (const tool of definitions) validateTool(route, tool)
    validateToolChoice(route, hosted?.toolChoice)
    const hasImageTool = definitions.some(tool => tool.type === 'image_generation')
    if (hasImageTool && hosted?.imageGeneration?.enabled !== true) throw new Error(`llm-openai-responses-bridge: provider "${route}" must explicitly enable imageGeneration for image_generation`)
    if (hosted?.imageGeneration?.enabled === true) {
      // The current public DSH LLM stream vocabulary has no safe assistant-image
      // output backend. Refuse the setting rather than writing arbitrary paths.
      throw new Error(`llm-openai-responses-bridge: provider "${route}" imageGeneration requires a verified DSH assistant-image output backend; none is available in DSH 0.1.2-alpha.1`)
    }
    if (hosted?.imageGeneration?.maxBytes !== undefined && (!Number.isSafeInteger(hosted.imageGeneration.maxBytes) || hosted.imageGeneration.maxBytes <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" imageGeneration.maxBytes must be a positive safe integer`)
    if (source.streamIdleTimeoutMs !== undefined && (!Number.isSafeInteger(source.streamIdleTimeoutMs) || source.streamIdleTimeoutMs <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" streamIdleTimeoutMs must be a positive safe integer`)
  }
}
