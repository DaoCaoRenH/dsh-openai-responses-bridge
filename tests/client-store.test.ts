import type { CredentialView, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T>(initial: T) => {
    let snapshot = structuredClone(initial)
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      update: (mutator: (draft: T) => void) => { const next = structuredClone(snapshot); mutator(next); snapshot = next; for (const listener of listeners) listener() },
      set: (next: T) => { snapshot = next; for (const listener of listeners) listener() },
    }
  },
}))

import { BRIDGE_SETTINGS_NS } from '../src/client/fields.ts'
import { BridgeSettingsStore } from '../src/client/store.ts'

function view(value: unknown, revision = 3): SettingsNamespaceView {
  return {
    ns: BRIDGE_SETTINGS_NS,
    schema: {},
    value,
    user: value,
    applies: 'live',
    secrets: [],
    revision,
  }
}

function apiFor(namespace: SettingsNamespaceView, credential: CredentialView = { configured: true, writable: true }) {
  return {
    settings: {
      describe: vi.fn(async () => ({ result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace] } } })),
    },
    llm: {
      // Adapter-only Bridge routes are returned by the Host with no
      // configurable-provider directory address. The standalone Bridge page
      // must still mark the route active from this row.
      providers: vi.fn(async () => ({ result: { ok: true as const, value: { providers: [{ provider: 'gateway', displayName: 'Gateway', settingsNs: '', settingsPath: [], active: true }] } } })),
    },
    credentials: {
      describe: vi.fn(async () => ({ result: { ok: true as const, value: { credentials: { NODUS_API_KEY: credential } } } })),
    },
  }
}

describe('BridgeSettingsStore', () => {
  it('joins routes with credential state without carrying a secret value', async () => {
    const api = apiFor(view({ providers: {
      gateway: {
        apiKeyEnv: 'NODUS_API_KEY',
        displayName: 'Gateway',
        baseURL: 'https://example.test/v1',
        models: [{ id: 'm' }],
        hostedTools: { enabled: false },
      },
    }}))
    const store = new BridgeSettingsStore(api as never)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.routes[0]).toMatchObject({ route: 'gateway', credentialRef: 'NODUS_API_KEY', active: true })
    expect(state.routes[0]).not.toHaveProperty('apiKey')
    expect(api.credentials.describe).toHaveBeenCalledWith({ refs: ['NODUS_API_KEY'] })
  })

  it('reports a missing namespace instead of writing to native llm-pi-ai', async () => {
    const api = apiFor(view({ providers: {} }))
    api.settings.describe.mockResolvedValue({ result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } } })
    const store = new BridgeSettingsStore(api as never)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'missing', routes: [] })
    expect(api.llm.providers).toHaveBeenCalledOnce()
  })
})
