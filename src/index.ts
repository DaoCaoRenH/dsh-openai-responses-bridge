import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { AuthContext, CredentialStore } from '@earendil-works/pi-ai'
import { Config, assertServiceable } from './config.ts'
import { discoverModels } from './discovery.ts'
import { currentInitiatorSession, registerHostedWebSearchSessionEvents } from './hosted-web-search/session.ts'
import { resolveProfiles } from './profiles.ts'
import { applyPwshSandboxSchem } from './pwshSandboxSchem.ts'
import { installPtcHostedWebSearch } from './ptc.ts'
import type { BridgeConfig } from './types.ts'

/** Cordis plugin identity; the bundle patch mounts this row by package name. */
export const name = 'llm-openai-responses-bridge'
/** The bridge needs the DSH LLM registry; settings and credentials are optional seams. */
export const inject = ['llm']
const NS = settingsNamespace('llm-openai-responses-bridge')

export { Config } from './config.ts'
export { assertServiceable } from './config.ts'
export { applyBridgeRequest } from './compatibility.ts'
export type * from './types.ts'

function registrationFacts(profiles: ReadonlyMap<string, { displayName: string; retryPolicy: unknown }>): string {
  return JSON.stringify([...profiles].map(([provider, profile]) => ({ provider, displayName: profile.displayName, retryPolicy: profile.retryPolicy })))
}

/**
 * Pi requires an auth store when it builds a model collection. Bridge routes
 * authenticate through their explicit apiKeyEnv reference instead, so this
 * store deliberately has no login persistence; authContext still exposes DSH
 * credentials to provider-native ambient lookups such as Google ADC names.
 */
function bridgeAuth(ctx: Context): { credentials: CredentialStore; authContext: AuthContext } {
  return {
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async (_provider, mutate) => mutate(undefined),
      delete: async () => undefined,
    },
    authContext: {
      env: async name => {
        if (isCredentialRefName(name)) {
          const value = await ctx.get('credentials')?.resolve(credentialRef(name))
          if (value !== undefined) return value.value
        }
        return launchEnvironmentOf(ctx).get(name)?.value
      },
      fileExists: async () => false,
    },
  }
}

/** Install the route registry, settings namespace, and credential resolution hooks. */
export function apply(ctx: Context, config: BridgeConfig): void {
  registerHostedWebSearchSessionEvents()
  // Keep the compatibility behavior in this bundle so installing Bridge is
  // sufficient; DSH still owns the actual sandbox and approval enforcement.
  applyPwshSandboxSchem(ctx)

  let current: () => BridgeConfig = () => config
  let lastRaw: BridgeConfig | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(raw, () => currentInitiatorSession(ctx))
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (provider: string, profile: ResolvedPiAiProviderProfile): Promise<string> => {
    const ref = profile.apiKeyEnv
    if (ref === undefined) throw new LlmError(`llm-openai-responses-bridge: provider "${provider}" requires apiKeyEnv`, 'MISSING_CREDENTIAL')
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (value !== undefined && value.trim().length > 0) return assertUsableApiKey(value, name, String(ref))
    throw new LlmError(`llm-openai-responses-bridge: no credential for provider route "${provider}"; set ${String(ref)} through DSH credentials or the launching environment`, 'MISSING_CREDENTIAL')
  }

  // The settings card asks about the endpoint currently being edited. The
  // one-shot key comes from the form when present; an already-existing Bridge
  // route may fall back to its credential reference without exposing the key
  // to the browser. This registration belongs to the Bridge namespace only and
  // does not add a protocol to native llm-pi-ai settings.
  ctx.llm.registerModelDiscovery(NS, (request, signal) => discoverModels(
    request,
    request.provider === undefined
      ? undefined
      : async () => {
          const profile = profiles().get(request.provider!)
          return profile === undefined ? undefined : resolveApiKey(request.provider!, profile)
        },
    signal,
  ))

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth: bridgeAuth(ctx),
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: detail => ctx.logger.warn(`llm-openai-responses-bridge: replay degraded for ${detail.provider}/${detail.model}: ${detail.reason}`),
  })

  installPtcHostedWebSearch(ctx, {
    current: () => current(),
    profiles,
    resolveApiKey,
  })

  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: string | undefined

  const syncRegistrations = (): void => {
    const resolved = profiles()
    const routes = [...resolved.keys()]
    const nextFacts = registrationFacts(resolved)
    if (nextFacts !== registeredFacts) {
      if (registration === undefined) {
        if (routes.length > 0) registration = ctx.llm.registerAdapter(routes, adapter)
      } else {
        registration.replace(routes)
      }
      registeredFacts = nextFacts
    }
  }

  syncRegistrations()
  installSettingsSection(ctx, NS, Config, config, {
    validate: assertServiceable,
    setSource: source => { current = source },
    onChange: () => {
      try {
        syncRegistrations()
      } catch (error: unknown) {
        ctx.logger.error('llm-openai-responses-bridge: rejected route topology update; previous routes remain active')
        ctx.logger.error(error)
      }
    },
  })
}

export default { name, inject, Config, apply }
