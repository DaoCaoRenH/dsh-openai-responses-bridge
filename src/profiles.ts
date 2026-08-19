import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamOptions,
  ThinkingLevelMap,
} from '@earendil-works/pi-ai'
import type { Session } from '@deepseek-ai/dsh-session'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { assertServiceable } from './config.ts'
import { applyBridgeRequest } from './compatibility.ts'
import { hostedWebSearchEnabled } from './compatibility.ts'
import { hostedResponsesStream, hostedResponsesStreamSimple } from './hosted-web-search/stream.ts'
import { DEFAULT_BRIDGE_API } from './types.ts'
import type { BridgeApiProtocol, BridgeConfig, BridgeModelProfile, BridgeProviderProfile, HostedToolsConfig } from './types.ts'

const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

function apiKeyAuth(name: string): Provider['auth'] {
  return {
    apiKey: {
      name,
      resolve: ({ credential }) => Promise.resolve({
        auth: credential?.key === undefined ? {} : { apiKey: credential.key },
        source: name,
      }),
    },
  }
}

function thinkingMap(model: BridgeModelProfile): ThinkingLevelMap | undefined {
  if (model.reasoningEfforts === undefined || model.reasoningEfforts === false) return undefined
  const map: ThinkingLevelMap = { off: 'none' }
  for (const [level, value] of Object.entries(model.reasoningEfforts)) {
    // Bridge's fixed map uses `off: null` to mean "omit provider thinking".
    // pi-ai uses null in thinkingLevelMap for an unsupported level, so keep
    // the initial native `off: none` entry instead of turning a valid default
    // into an UNSUPPORTED_REASONING_EFFORT failure.
    if (level === 'off' && value === null) continue
    map[level as keyof ThinkingLevelMap] = value ?? null
  }
  return map
}

function buildModel(route: string, baseURL: string, api: BridgeApiProtocol, profile: BridgeModelProfile): Model<Api> {
  const input = [...profile.input ?? ['text']]
  const reasoning = profile.reasoningEfforts !== undefined && profile.reasoningEfforts !== false
  const levelMap = thinkingMap(profile)
  return {
    id: profile.id,
    name: profile.name ?? profile.id,
    api,
    provider: route,
    baseUrl: baseURL,
    reasoning,
    ...levelMap === undefined ? {} : { thinkingLevelMap: levelMap },
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
}

function providerFor(
  route: string,
  source: BridgeProviderProfile,
  api: BridgeApiProtocol,
  models: readonly Model<Api>[],
  hosted: HostedToolsConfig | undefined,
  resolveSession: () => Session | undefined,
): Provider {
  const native = api === 'google-generative-ai' ? googleGenerativeAIApi() : openAIResponsesApi()
  const withBridgePayload = <T extends StreamOptions>(options: T | undefined): T => {
    const original = options?.onPayload
    return {
      ...options,
      onPayload: async (payload: unknown, model: Model<Api>) => {
        const replacement = await original?.(payload, model)
        return applyBridgeRequest(replacement ?? payload, hosted)
      },
    } as T
  }
  const stream = (model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream =>
    api === 'google-generative-ai'
      ? native.stream(model, context, options)
      : hostedWebSearchEnabled(hosted)
        ? hostedResponsesStream(model, context, withBridgePayload(options), {
            hostedTools: hosted,
            resolveSession,
          })
        : native.stream(model, context, withBridgePayload(options))
  const streamSimple = (model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream =>
    api === 'google-generative-ai'
      ? native.streamSimple(model, context, options)
      : hostedWebSearchEnabled(hosted)
        ? hostedResponsesStreamSimple(model, context, withBridgePayload(options), {
            hostedTools: hosted,
            resolveSession,
          })
        : native.streamSimple(model, context, withBridgePayload(options))
  return {
    id: route,
    name: source.displayName ?? route,
    ...source.baseURL === undefined ? {} : { baseUrl: source.baseURL },
    auth: apiKeyAuth(source.displayName ?? route),
    getModels: () => models,
    stream,
    streamSimple,
  }
}

/** Resolve settings into the profile objects expected by the public PiAiAdapter. */
export function resolveProfiles(
  config: BridgeConfig,
  resolveSession: () => Session | undefined = () => undefined,
): Map<string, ResolvedPiAiProviderProfile> {
  // Cordis and the settings service both hand this function schema-resolved
  // snapshots. Settings snapshots are deeply frozen; resolving them through
  // Schemastery again would try to materialize defaults in place and fail on
  // the first live update. Keep Config at the plugin/settings boundary and
  // consume the detached snapshot here, as dsh-llm-pi-ai does.
  const resolvedConfig = config ?? { providers: {} }
  assertServiceable(resolvedConfig)
  const result = new Map<string, ResolvedPiAiProviderProfile>()
  for (const [route, source] of Object.entries(resolvedConfig.providers ?? {})) {
    const api = source.api ?? DEFAULT_BRIDGE_API
    const modelProfiles = source.models ?? []
    const models = modelProfiles.map(model => buildModel(route, source.baseURL!, api, model))
    const configuredMaxTokens = new Map<string, number>()
    for (const model of modelProfiles) if (model.maxTokens !== undefined) configuredMaxTokens.set(model.id, model.maxTokens)
    const retryPolicy: ResolvedRetryPolicy = resolveRetryPolicy(source.retryPolicy, `llm-openai-responses-bridge: provider "${route}" retryPolicy`)
    const apiKeyEnv: CredentialRef = credentialRef(source.apiKeyEnv!)
    const profile = {
      provider: route,
      displayName: source.displayName ?? route,
      // The route is Bridge-owned, but the model uses pi-ai's native
      // Responses implementation so DSH receives the same replay and stream
      // semantics as its built-in OpenAI Responses provider.
      api,
      apiKeyEnv,
      ...source.baseURL === undefined ? {} : { baseURL: source.baseURL },
      ...source.reasoning === undefined ? {} : { reasoning: source.reasoning },
      ...source.headers === undefined ? {} : { headers: { ...source.headers } },
      streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy,
      piProvider: providerFor(route, source, api, models, source.hostedTools, resolveSession),
      configuredMaxTokens,
    } satisfies ResolvedPiAiProviderProfile
    result.set(route, profile)
  }
  return result
}
