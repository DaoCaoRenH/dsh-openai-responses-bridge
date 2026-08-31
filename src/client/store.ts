import type {
  BridgeCredentialsRemote, BridgeLlmRemote, BridgeSettingsRemote, CredentialInfo, SettingsNamespaceView,
} from './remote.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  BRIDGE_SETTINGS_NS, credentialRefOf, providerAt, webSearchEnabled,
} from './fields.ts'
import type { BridgeProviderProfile } from '../types.ts'

/** A route row rendered by the Bridge settings section. */
export interface BridgeRouteRow {
  route: string
  profile: BridgeProviderProfile
  credentialRef: string | undefined
  credential: CredentialInfo | undefined
  active: boolean
  displayName: string
}

/** Browser state for one mounted settings section. */
export interface BridgeSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  error: string | null
  credentialError: string | null
  writable: boolean
  revision: number
  namespace: SettingsNamespaceView | undefined
  routes: readonly BridgeRouteRow[]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function routeEntries(namespace: SettingsNamespaceView, providers: readonly { id: string }[]): BridgeRouteRow[] {
  const source = recordOf(recordOf(namespace.value).providers)
  // Bridge routes intentionally do not register as configurable-directory
  // entries: DSH's native ModelsSection renders that directory, which would
  // mix Bridge routes into the native page. The current Host API reports live
  // adapter routes separately, so the route id is all this page needs.
  const active = new Set(providers.map(entry => entry.id))
  return Object.entries(source).flatMap(([route, raw]) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const profile = raw as BridgeProviderProfile
    return [{
      route,
      profile,
      credentialRef: credentialRefOf(profile),
      credential: undefined,
      active: active.has(route),
      displayName: typeof profile.displayName === 'string' && profile.displayName.length > 0
        ? profile.displayName
        : route,
    }]
  })
}

/** Settings/credentials/LLM join owned by this one page. */
export class BridgeSettingsStore {
  readonly store: SnapshotStore<BridgeSettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    credentialError: null,
    writable: false,
    revision: 0,
    namespace: undefined,
    routes: [],
  })

  private generation = 0

  constructor(private readonly api: {
    settings: BridgeSettingsRemote
    credentials: Pick<BridgeCredentialsRemote, 'describe'>
    llm: BridgeLlmRemote
  }) {}

  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update(state => { state.status = 'loading'; state.error = null })
    try {
      const [settingsResponse, providersResponse] = await Promise.all([
        this.api.settings.describe(),
        this.api.llm.listProviders(),
      ])
      if (!settingsResponse.ok) throw new Error(settingsResponse.error.message)
      const settingsValue = settingsResponse.value
      const namespace = settingsValue.namespaces.find(
        (view: SettingsNamespaceView) => view.ns === BRIDGE_SETTINGS_NS,
      )
      if (namespace === undefined) {
        if (generation !== this.generation) return
        this.store.update(state => {
          state.status = 'missing'
          state.writable = settingsValue.writable
          state.namespace = undefined
          state.routes = []
          state.revision = 0
        })
        return
      }
      const providers = providersResponse.ok ? providersResponse.value : []
      const routes = routeEntries(namespace, providers)
      const refs = [...new Set(routes.flatMap(route => route.credentialRef === undefined ? [] : [route.credentialRef]))]
      let credentialError: string | null = null
      let credentials: Record<string, CredentialInfo> = {}
      if (refs.length > 0) {
        try {
          const credentialsResponse = await this.api.credentials.describe(refs)
          if (credentialsResponse.ok) credentials = credentialsResponse.value
          else credentialError = credentialsResponse.error.message
        } catch (error) {
          credentialError = messageOf(error)
        }
      }
      if (generation !== this.generation) return
      this.store.update(state => {
        state.status = 'ready'
        state.error = null
        state.credentialError = credentialError
        state.writable = settingsValue.writable
        state.namespace = namespace
        state.revision = namespace.revision
        state.routes = routes.map(route => ({
          ...route,
          ...route.credentialRef !== undefined && credentials[route.credentialRef] !== undefined
            ? { credential: credentials[route.credentialRef] }
            : {},
        }))
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update(state => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  dispose(): void {
    this.generation += 1
  }
}

/** Refresh only after a section has been opened once. */
export function refreshIfLoaded(controller: BridgeSettingsStore): void {
  const status = controller.store.getSnapshot().status
  if (status === 'idle' || status === 'loading') return
  void controller.load()
}

/** Visible state helper kept pure for unit tests and future cards. */
export function routeWebSearchEnabled(row: BridgeRouteRow): boolean {
  return webSearchEnabled(row.profile)
}

/** Read an existing route from the latest section snapshot. */
export function routeFromState(state: BridgeSettingsState, route: string): BridgeProviderProfile | undefined {
  return providerAt(state.namespace, route)
}

export { messageOf }
