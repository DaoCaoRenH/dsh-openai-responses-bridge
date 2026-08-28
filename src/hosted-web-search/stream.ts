import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from 'openai/resources/responses/responses.js'
import {
  clampThinkingLevel,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream as AssistantMessageEventStreamType,
  type CacheRetention,
  type Context,
  type Model,
  type ProviderEnv,
  type SimpleStreamOptions,
  type StreamOptions,
} from '@earendil-works/pi-ai'
import { clampOpenAIPromptCacheKey } from '@earendil-works/pi-ai/api/openai-prompt-cache'
import { createGrammarToolInputProperties } from '@earendil-works/pi-ai/api/constrained-sampling'
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { buildBaseOptions } from '@earendil-works/pi-ai/api/simple-options'
import type { Session } from '@deepseek-ai/dsh-session'
import type { HostedToolsConfig } from '../types.ts'
import { HostedWebSearchObserver } from './normalize.ts'
import {
  activeTurnStep,
  appendHostedWebSearchCheckpoint,
} from './session.ts'
import { createResponsesClient, responseHeaders } from './transport.ts'
import type { SessionAffinityFormat } from './transport.ts'

const OPENAI_TOOL_CALL_PROVIDERS = new Set(['openai', 'openai-codex', 'opencode'])
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16

interface ResponsesCompatOptions {
  sessionAffinityFormat?: SessionAffinityFormat
  supportsLongCacheRetention?: boolean
  supportsStrictMode?: boolean
  supportsOpenAIGrammarTools?: boolean
  supportsExplicitPromptCacheMode?: boolean
}

interface ExtendedStreamOptions extends StreamOptions {
  reasoningEffort?: string
  reasoningSummary?: string
  serviceTier?: ResponseCreateParamsStreaming['service_tier']
  toolChoice?: ResponseCreateParamsStreaming['tool_choice']
}

export interface HostedResponsesStreamConfig {
  hostedTools: HostedToolsConfig | undefined
  resolveSession: () => Session | undefined
}

function buildParams(model: Model<Api>, context: Context, options: ExtendedStreamOptions | undefined): Record<string, unknown> {
  const compat = model.compat as ResponsesCompatOptions | undefined
  const supportsStrictMode = compat?.supportsStrictMode ?? false
  const supportsOpenAIGrammarTools = compat?.supportsOpenAIGrammarTools ?? false
  const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env)
  const supportsLongCacheRetention = compat?.supportsLongCacheRetention ?? true
  const supportsExplicitPromptCacheMode = compat?.supportsExplicitPromptCacheMode ?? false
  const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, supportsOpenAIGrammarTools)
  const params: Record<string, unknown> = {
    model: model.id,
    input: convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
      grammarToolInputProperties,
      toolOptions: { supportsStrictMode, supportsOpenAIGrammarTools },
    }),
    stream: true,
    prompt_cache_key: cacheRetention === 'none' ? undefined : clampOpenAIPromptCacheKey(options?.sessionId),
    prompt_cache_retention: cacheRetention === 'long' && supportsLongCacheRetention ? '24h' : undefined,
    prompt_cache_options: cacheRetention === 'none' && supportsExplicitPromptCacheMode ? { mode: 'explicit' } : undefined,
    store: false,
  }
  if (options?.sessionId !== undefined && options.cacheRetention !== 'none') params.prompt_cache_key = options.sessionId
  if (options?.maxTokens !== undefined && options.maxTokens > 0) {
    params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS)
  }
  if (options?.temperature !== undefined) params.temperature = options.temperature
  if (options?.serviceTier !== undefined) params.service_tier = options.serviceTier
  if ((context.tools?.length ?? 0) > 0) {
    params.tools = convertResponsesTools(context.tools ?? [], {
      supportsStrictMode,
      supportsOpenAIGrammarTools,
    })
  }
  if (options?.toolChoice !== undefined) params.tool_choice = options.toolChoice
  if (model.reasoning) {
    if (options?.reasoningEffort !== undefined || options?.reasoningSummary !== undefined) {
      const effort = options.reasoningEffort === undefined
        ? 'medium'
        : (model.thinkingLevelMap?.[options.reasoningEffort as keyof NonNullable<Model<Api>['thinkingLevelMap']>] ?? options.reasoningEffort)
      params.reasoning = {
        effort,
        summary: options.reasoningSummary ?? 'auto',
      }
      params.include = ['reasoning.encrypted_content']
    } else if (model.provider !== 'github-copilot' && model.thinkingLevelMap?.off !== null) {
      params.reasoning = { effort: model.thinkingLevelMap?.off ?? 'none' }
    }
  }
  return params
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveCacheRetention(cacheRetention: CacheRetention | undefined, env: ProviderEnv | undefined): CacheRetention {
  if (cacheRetention !== undefined) return cacheRetention
  if (env?.PI_CACHE_RETENTION === 'long' || process.env.PI_CACHE_RETENTION === 'long') return 'long'
  return 'short'
}

async function* observedStream(
  source: AsyncIterable<ResponseStreamEvent>,
  observer: HostedWebSearchObserver,
  signal: AbortSignal | undefined,
): AsyncIterable<ResponseStreamEvent> {
  try {
    for await (const event of source) {
      observer.observe(event)
      yield event
    }
    observer.finish('failed', { message: 'Responses stream ended before a terminal event', code: 'STREAM_INCOMPLETE' })
  } catch (error: unknown) {
    observer.finish(signal?.aborted === true ? 'aborted' : 'failed', {
      message: signal?.aborted === true ? 'Hosted web search request aborted' : errorMessage(error),
      code: signal?.aborted === true ? 'ABORTED' : 'STREAM_ERROR',
    })
    throw error
  }
}

/**
 * Hosted-enabled Responses path. Only this path owns the HTTP stream: Pi's
 * public converters and `processResponsesStream()` still own message,
 * reasoning, usage, error, and replay semantics. Hosted-disabled routes never
 * call this function and remain on `openAIResponsesApi()`.
 */
export function hostedResponsesStream(
  model: Model<Api>,
  context: Context,
  options: ExtendedStreamOptions | undefined,
  config: HostedResponsesStreamConfig,
): AssistantMessageEventStreamType {
  const stream = createAssistantMessageEventStream()
  const session = config.resolveSession()
  const location = session === undefined ? { turn: 0, step: 0 } : activeTurnStep(session)
  const observer = new HostedWebSearchObserver({
    provider: String(model.provider),
    model: model.id,
    ...location,
    onCheckpoint: (kind, state) => {
      appendHostedWebSearchCheckpoint(
        session,
        `bridge/hosted-web-search/${kind}` as 'bridge/hosted-web-search/start' | 'bridge/hosted-web-search/update' | 'bridge/hosted-web-search/end',
        state,
      )
    },
  })

  void (async () => {
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    try {
      const client = createResponsesClient(model, {
        ...options?.apiKey === undefined ? {} : { apiKey: options.apiKey },
        ...options?.headers === undefined ? {} : { headers: options.headers },
        ...options?.sessionId === undefined ? {} : { session: options.sessionId },
      })
      const rawParams = buildParams(model, context, options)
      const replacement = await options?.onPayload?.(rawParams, model)
      const params = (replacement ?? rawParams) as ResponseCreateParamsStreaming
      const requestOptions = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        maxRetries: 0,
      }
      const { data, response } = await client.responses.create(params, requestOptions).withResponse()
      await options?.onResponse?.({ status: response.status, headers: responseHeaders(response) }, model)
      stream.push({ type: 'start', partial: output })
      const compat = model.compat as ResponsesCompatOptions | undefined
      await processResponsesStream(
        observedStream(data as AsyncIterable<ResponseStreamEvent>, observer, options?.signal),
        output,
        stream,
        model,
        {
          grammarToolInputProperties: createGrammarToolInputProperties(context.tools, compat?.supportsOpenAIGrammarTools ?? false),
          ...options?.serviceTier === undefined ? {} : { serviceTier: options.serviceTier },
        },
      )
      if (options?.signal?.aborted === true) throw new Error('Request was aborted')
      if (output.stopReason === 'aborted' || output.stopReason === 'error') throw new Error('An unknown error occurred')
      stream.push({ type: 'done', reason: output.stopReason as 'stop' | 'length' | 'toolUse', message: output })
      stream.end()
    } catch (error: unknown) {
      observer.finish(options?.signal?.aborted === true ? 'aborted' : 'failed', {
        message: options?.signal?.aborted === true ? 'Request was aborted' : errorMessage(error),
        code: options?.signal?.aborted === true ? 'ABORTED' : 'RESPONSES_ERROR',
      })
      for (const block of output.content) {
        delete (block as { index?: number }).index
        delete (block as { partialJson?: string }).partialJson
        delete (block as { customInput?: unknown }).customInput
      }
      output.stopReason = options?.signal?.aborted === true ? 'aborted' : 'error'
      output.errorMessage = errorMessage(error)
      stream.push({ type: 'error', reason: output.stopReason, error: output })
      stream.end()
    }
  })()
  return stream
}

/** Pi-compatible simple entry point for the hosted-enabled path. */
export function hostedResponsesStreamSimple(
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  config: HostedResponsesStreamConfig,
): AssistantMessageEventStreamType {
  const base = buildBaseOptions(model, context, options, options?.apiKey)
  const clamped = options?.reasoning === undefined ? undefined : clampThinkingLevel(model, options.reasoning)
  return hostedResponsesStream(model, context, {
    ...base,
    ...clamped === undefined || clamped === 'off' ? {} : { reasoningEffort: clamped },
  }, config)
}
