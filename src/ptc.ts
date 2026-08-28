import type { Context } from '@deepseek-ai/cordis'
import {
  RUN_CODE_NAME,
  type ToolDispatchExecution,
  type ToolExecutionResult,
  type ToolExecutionToken,
  type JsonValue,
} from '@deepseek-ai/dsh-tools'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { DEFAULT_BRIDGE_API } from './types.ts'
import type { BridgeConfig } from './types.ts'
import { hostedWebSearchEnabled } from './compatibility.ts'
import { executeHostedWebSearch } from './hosted-web-search/executor.ts'

interface PtcInstallOptions {
  current: () => BridgeConfig
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string>
}

interface RoutedTarget {
  provider: string
  model: string
}

function routedTarget(exec: ToolDispatchExecution): RoutedTarget | undefined {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) return undefined
  return { provider, model }
}

function errorInfo(error: unknown): { name: string; code: string } | undefined {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
  const code = typeof record?.code === 'string' && record.code.length > 0 ? record.code : undefined
  if (code === undefined) return undefined
  const name = error instanceof Error && error.name.length > 0 ? error.name : 'BridgeHostedWebSearchError'
  return { name, code }
}

function failureResult(error: unknown): ToolExecutionResult {
  const message = error instanceof Error ? error.message : String(error)
  const info = errorInfo(error)
  return {
    isError: true,
    error: {
      message,
      ...info === undefined ? {} : { info },
    },
    content: [{ type: 'text', text: `Error: ${message}` }],
  }
}

function modelFor(profile: ResolvedPiAiProviderProfile, modelId: string): Model<Api> | undefined {
  return profile.piProvider.getModels().find(model => model.id === modelId) as Model<Api> | undefined
}

function isNestedRunCodeSearch(exec: ToolDispatchExecution, activeRunCodes: ReadonlySet<ToolExecutionToken>): boolean {
  return exec.name === 'web_search'
    && exec.parent !== undefined
    && activeRunCodes.has(exec.parent)
}

/** Install the PTC nested-dispatch bridge without registering a second tool. */
export function installPtcHostedWebSearch(ctx: Context, options: PtcInstallOptions): void {
  // The LLM-only composition remains loadable without dsh-tools. DSH bundles
  // that expose Code Mode provide the event plane. The registry is a host
  // service while Code Mode presentation is agent-scoped, so waiting on an
  // injected `tools` service would miss the host listener in real bundles.
  const activeRunCodes = new Set<ToolExecutionToken>()
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
      if (exec.name === RUN_CODE_NAME) {
        activeRunCodes.add(exec.token)
        try {
          return await next()
        } finally {
          activeRunCodes.delete(exec.token)
        }
      }

      if (!isNestedRunCodeSearch(exec, activeRunCodes)) return next()
      const target = routedTarget(exec)
      if (target === undefined) return failureResult(new Error('Bridge could not determine the active provider and model for PTC web search'))

      const source = options.current().providers?.[target.provider]
      const api = source?.api ?? DEFAULT_BRIDGE_API
      // Native, Google, disabled, and malformed routes keep DSH's own search
      // executor. A configured Bridge route never silently falls back after the
      // hosted path has been selected; credential/request failures are returned.
      if (source === undefined || api !== 'openai-responses' || !hostedWebSearchEnabled(source.hostedTools)) {
        return next()
      }

      const profile = options.profiles().get(target.provider)
      if (profile === undefined) return failureResult(new Error(`Bridge provider route "${target.provider}" is not available`))
      const model = modelFor(profile, target.model)
      if (model === undefined) return failureResult(new Error(`Bridge provider route "${target.provider}" has no model "${target.model}"`))

      try {
        const apiKey = await options.resolveApiKey(target.provider, profile)
        const value = await executeHostedWebSearch(exec.arguments, {
          model,
          apiKey,
          hostedTools: source.hostedTools as NonNullable<typeof source.hostedTools>,
          ...exec.agent?.session === undefined ? {} : { session: exec.agent.session },
          searchIdPrefix: String(exec.callId),
          signal: exec.signal,
        })
        return { isError: false, value: value as unknown as JsonValue, content: [] }
      } catch (error: unknown) {
        return failureResult(error)
      }
  }, { global: true })
}
