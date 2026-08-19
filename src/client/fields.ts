import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { BRIDGE_API_PROTOCOLS, DEFAULT_BRIDGE_API, DEFAULT_REASONING_EFFORTS } from '../types.ts'
import type { BridgeApiProtocol, BridgeModelProfile, BridgeProviderProfile, HostedToolsConfig } from '../types.ts'
import { validateBridgeModels } from './modelFields.ts'
import type { BridgeModelDraft } from './modelFields.ts'

/** The only settings namespace owned by the Bridge browser half. */
export const BRIDGE_SETTINGS_NS = 'llm-openai-responses-bridge'

export interface ProviderDraft {
  route: string
  displayName: string
  baseURL: string
  api: BridgeApiProtocol
  apiKey: string
  models: BridgeModelDraft[]
  webSearch: boolean
}

/** A new draft starts with an empty model list, like DSH's native card. */
export function initialProviderDraft(): ProviderDraft {
  return {
    route: '',
    displayName: '',
    baseURL: '',
    api: DEFAULT_BRIDGE_API,
    apiKey: '',
    models: [],
    webSearch: false,
  }
}

export interface DraftValidation {
  field: keyof ProviderDraft | 'models'
  message: string
  index?: number
}

const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/u

function modelFailureMessage(key: string, index: number): string {
  const prefix = `模型 ${index + 1}`
  switch (key) {
    case 'modelIdRequired': return `${prefix} 的 Model ID 不能为空。`
    case 'modelIdDuplicate': return `${prefix} 的 Model ID 与其他模型重复。`
    case 'modelNameInvalid': return `${prefix} 的显示名称必须是非空文本。`
    case 'modelContextInvalid': return `${prefix} 的 Context window 必须是正整数。`
    case 'modelMaxTokensInvalid': return `${prefix} 的 Max tokens 必须是正整数。`
    case 'modelInputInvalid': return `${prefix} 至少需要支持一种输入类型。`
    default: return `${prefix} 的配置无效。`
  }
}

/** Validate only facts the Bridge card owns before sending a Host mutation. */
export function validateProviderDraft(
  draft: ProviderDraft,
  existingRoutes: Iterable<string> = [],
  options: { requireApiKey?: boolean } = {},
): DraftValidation | undefined {
  const route = draft.route.trim()
  if (!ROUTE_PATTERN.test(route)) {
    return { field: 'route', message: 'Provider ID 需以小写字母开头，之后使用小写字母、数字或短横线。' }
  }
  if ([...existingRoutes].includes(route)) {
    return { field: 'route', message: '已有提供方使用这个 Provider ID。' }
  }
  if (!BRIDGE_API_PROTOCOLS.includes(draft.api)) {
    return { field: 'api', message: 'API 协议不受当前 Bridge 支持。' }
  }
  let url: URL
  try {
    url = new URL(draft.baseURL.trim())
  } catch {
    return { field: 'baseURL', message: 'API 地址必须是绝对 HTTP(S) URL。' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { field: 'baseURL', message: 'API 地址必须使用 http 或 https。' }
  }
  if (options.requireApiKey !== false && draft.apiKey.trim().length === 0) {
    return { field: 'apiKey', message: '请输入 API 密钥。' }
  }
  const modelFailure = validateBridgeModels(draft.models)
  if (modelFailure !== undefined) {
    return {
      field: 'models',
      index: modelFailure.index,
      message: modelFailureMessage(modelFailure.key, modelFailure.index),
    }
  }
  if (draft.models.length === 0) return { field: 'models', message: '至少需要添加一个模型。' }
  return undefined
}

function modelProfileFromDraft(model: BridgeModelDraft): BridgeModelProfile {
  return {
    id: model.id.trim(),
    ...model.name === undefined || model.name.trim().length === 0 ? {} : { name: model.name.trim() },
    input: model.input === undefined || model.input.length === 0 ? ['text'] : [...model.input],
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    reasoningEfforts: model.reasoningEfforts === undefined
      ? { ...DEFAULT_REASONING_EFFORTS }
      : model.reasoningEfforts,
  }
}

/** Derive the private DSH credential reference used for a newly created route. */
export function deriveApiKeyRef(route: string): string {
  const normalized = route.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return `DSH_BRIDGE_${normalized || 'PROVIDER'}_API_KEY`
}

/** Build the new route without including the write-only API key value. */
export function providerProfileFromDraft(draft: ProviderDraft): BridgeProviderProfile {
  return {
    api: draft.api,
    apiKeyEnv: deriveApiKeyRef(draft.route),
    displayName: draft.displayName.trim() || draft.route.trim(),
    baseURL: draft.baseURL.trim(),
    models: draft.models.map(modelProfileFromDraft),
    hostedTools: hostedToolsFromToggle(draft.api === 'openai-responses' && draft.webSearch),
  }
}

/**
 * Rehydrate only the fields owned by the Bridge editor. Credentials remain
 * write-only, so an edit draft deliberately starts with an empty API-key box.
 */
export function providerDraftFromProfile(route: string, profile: BridgeProviderProfile): ProviderDraft {
  const api = profile.api ?? DEFAULT_BRIDGE_API
  return {
    route,
    displayName: profile.displayName ?? route,
    baseURL: profile.baseURL ?? '',
    api,
    apiKey: '',
    models: (profile.models ?? []).map(model => ({
      ...model,
      ...model.input === undefined ? {} : { input: [...model.input] },
      ...model.reasoningEfforts === undefined
        ? { reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } }
        : { reasoningEfforts: model.reasoningEfforts === false ? false : { ...model.reasoningEfforts } },
    })),
    webSearch: api === 'openai-responses' && profile.hostedTools?.enabled === true,
  }
}

/**
 * Build an edit patch without replacing the whole provider object. This keeps
 * settings owned by other Bridge surfaces (headers, retry policy, hosted tool
 * definitions, and so on) intact.
 */
export function providerEditOps(
  route: string,
  profile: BridgeProviderProfile,
  draft: ProviderDraft,
): SettingsPathOpView[] {
  const base = ['providers', route]
  const ops: SettingsPathOpView[] = [
    { op: 'set', path: [...base, 'displayName'], value: draft.displayName.trim() || route },
    { op: 'set', path: [...base, 'baseURL'], value: draft.baseURL.trim() },
    { op: 'set', path: [...base, 'api'], value: draft.api },
    { op: 'set', path: [...base, 'models'], value: draft.models.map(modelProfileFromDraft) },
  ]
  if (draft.apiKey.trim().length > 0 && profile.apiKeyEnv === undefined) {
    ops.push({ op: 'set', path: [...base, 'apiKeyEnv'], value: deriveApiKeyRef(route) })
  }
  ops.push(...webSearchOps(route, profile, draft.webSearch, draft.api))
  return ops
}

/** Remove one Bridge route without rebuilding the rest of the namespace. */
export function providerDeleteOps(route: string): SettingsPathOpView[] {
  return [{ op: 'unset', path: ['providers', route] }]
}

/** The exact hosted-tools object used when a new route is created. */
export function hostedToolsFromToggle(enabled: boolean): HostedToolsConfig {
  if (!enabled) return { enabled: false }
  return {
    enabled: true,
    definitions: [{ type: 'web_search' }],
    toolChoice: 'auto',
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one effective route profile from a redacted settings descriptor. */
export function providerAt(view: SettingsNamespaceView | undefined, route: string): BridgeProviderProfile | undefined {
  if (view === undefined) return undefined
  const providers = objectOf(objectOf(view.value).providers)
  const profile = providers[route]
  return profile === undefined ? undefined : profile as BridgeProviderProfile
}

/** Read the reference without ever asking the browser for its value. */
export function credentialRefOf(profile: BridgeProviderProfile | undefined): string | undefined {
  return stringOf(profile?.apiKeyEnv)
}

/** Whether a route has opted into the remote Responses web search tool. */
export function webSearchEnabled(profile: BridgeProviderProfile | undefined): boolean {
  return profile?.api !== 'google-generative-ai' && profile?.hostedTools?.enabled === true
}

function hasWebSearch(definitions: unknown): boolean {
  return Array.isArray(definitions) && definitions.some((tool) => {
    const type = objectOf(tool).type
    return type === 'web_search' || type === 'web_search_preview'
  })
}

/** Build minimal path operations for a summary-card web_search toggle. */
export function webSearchOps(route: string, profile: BridgeProviderProfile, enabled: boolean, api: BridgeApiProtocol = profile.api ?? DEFAULT_BRIDGE_API): SettingsPathOpView[] {
  const base = ['providers', route, 'hostedTools']
  const effectiveEnabled = api === 'openai-responses' && enabled
  const ops: SettingsPathOpView[] = [{ op: 'set', path: [...base, 'enabled'], value: effectiveEnabled }]
  if (!effectiveEnabled) return ops
  const hosted = objectOf(profile.hostedTools)
  if (!hasWebSearch(hosted.definitions)) {
    const definitions = Array.isArray(hosted.definitions) ? [...hosted.definitions, { type: 'web_search' }] : [{ type: 'web_search' }]
    ops.push({ op: 'set', path: [...base, 'definitions'], value: definitions })
  }
  if (hosted.toolChoice === undefined) ops.push({ op: 'set', path: [...base, 'toolChoice'], value: 'auto' })
  return ops
}

/** Return only safe presentation fields used by the summary card. */
export function summaryOf(profile: BridgeProviderProfile): {
  baseURL: string
  model: string
} {
  const model = Array.isArray(profile.models) ? profile.models[0] : undefined
  return {
    baseURL: stringOf(profile.baseURL) ?? '',
    model: stringOf(objectOf(model).id) ?? '—',
  }
}
