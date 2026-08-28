import { describe, expect, it } from 'vitest'
import {
  hostedToolsFromToggle, initialProviderDraft, providerProfileFromDraft,
  deriveApiKeyRef, providerDeleteOps, providerDraftFromProfile, providerEditOps, validateProviderDraft, webSearchOps,
} from '../src/client/fields.ts'
import { DEFAULT_REASONING_EFFORTS } from '../src/types.ts'

describe('Bridge settings card fields', () => {
  it('creates a safe route with hosted tools disabled and derives an internal credential reference', () => {
    const draft = {
      ...initialProviderDraft(),
      route: 'custom-bridge',
      displayName: 'Custom Bridge',
      baseURL: 'https://example.test/v1',
      apiKey: 'secret-value',
      models: [{ id: 'gpt-5.6-luna', contextWindow: 131072, maxTokens: 32768 }],
    }
    expect(validateProviderDraft(draft)).toBeUndefined()
    expect(providerProfileFromDraft(draft)).toMatchObject({
      api: 'openai-responses',
      apiKeyEnv: deriveApiKeyRef('custom-bridge'),
      hostedTools: { enabled: false },
      models: [{
        id: 'gpt-5.6-luna',
        contextWindow: 131072,
        maxTokens: 32768,
        reasoningEfforts: DEFAULT_REASONING_EFFORTS,
      }],
    })
    expect(providerProfileFromDraft(draft)).not.toHaveProperty('compatibilityPreset')
    expect(JSON.stringify(providerProfileFromDraft(draft))).not.toContain('secret-value')
  })

  it('rehydrates an edit draft without exposing credentials and patches only editor-owned fields', () => {
    const original = {
      apiKeyEnv: 'GATEWAY_KEY',
      displayName: 'Gateway',
      baseURL: 'https://example.test/v1',
      models: [{ id: 'model-a', reasoningEfforts: false as const }],
      reasoning: 'medium' as const,
      headers: { 'x-tenant': 'tenant-a' },
      retryPolicy: { mode: 'normal' as const, maxRetries: 3 },
      hostedTools: {
        enabled: true,
        definitions: [{ type: 'file_search', vector_store_ids: ['vs_1'] }],
        toolChoice: 'required' as const,
      },
    }
    const draft = providerDraftFromProfile('gateway', original)
    expect(draft.apiKey).toBe('')
    expect(draft).not.toHaveProperty('reasoning')
    expect(draft.models[0]?.reasoningEfforts).toBe(false)

    const defaultDraft = providerDraftFromProfile('default', {
      apiKeyEnv: 'DEFAULT_KEY',
      baseURL: 'https://example.test/v1',
      models: [{ id: 'default-model' }],
    })
    expect(defaultDraft.api).toBe('openai-responses')
    expect(defaultDraft.models[0]?.reasoningEfforts).toEqual(DEFAULT_REASONING_EFFORTS)

    const ops = providerEditOps('gateway', original, {
      ...draft,
      displayName: 'Gateway Updated',
      apiKey: 'replacement-secret',
      webSearch: false,
    })
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'gateway', 'displayName'], value: 'Gateway Updated' })
    expect(ops).not.toContainEqual({ op: 'unset', path: ['providers', 'gateway', 'reasoning'] })
    expect(ops).toContainEqual({ op: 'set', path: ['providers', 'gateway', 'hostedTools', 'enabled'], value: false })
    expect(ops.some(op => op.path.length === 2)).toBe(false)
    expect(JSON.stringify(ops)).not.toContain('tenant-a')
    expect(JSON.stringify(ops)).not.toContain('maxAttempts')
    expect(JSON.stringify(ops)).not.toContain('replacement-secret')
  })

  it('uses the fixed reasoning map for new models', () => {
    expect(DEFAULT_REASONING_EFFORTS).toEqual({
      off: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
    const profile = providerProfileFromDraft({
      ...initialProviderDraft(),
      route: 'fixed-reasoning',
      baseURL: 'https://example.test/v1',
      apiKey: 'secret',
      models: [{ id: 'm' }],
    })
    expect(profile.models?.[0]?.reasoningEfforts).toEqual(DEFAULT_REASONING_EFFORTS)
  })

  it('persists the selected Google protocol and keeps hosted web_search off', () => {
    const draft = {
      ...initialProviderDraft(),
      route: 'google',
      api: 'google-generative-ai' as const,
      baseURL: 'https://example.test/v1beta',
      apiKey: 'secret',
      models: [{ id: 'gemini-3.6-flash', input: ['text', 'image'] as Array<'text' | 'image'> }],
      webSearch: true,
    }
    expect(validateProviderDraft(draft)).toBeUndefined()
    expect(providerProfileFromDraft(draft)).toMatchObject({
      api: 'google-generative-ai',
      hostedTools: { enabled: false },
    })
    expect(providerDraftFromProfile('google', {
      api: 'google-generative-ai',
      apiKeyEnv: 'GOOGLE_KEY',
      baseURL: 'https://example.test/v1beta',
      models: [{ id: 'gemini-3.6-flash' }],
    })).toMatchObject({ api: 'google-generative-ai', webSearch: false })
    expect(webSearchOps('google', { api: 'google-generative-ai', apiKeyEnv: 'KEY', baseURL: 'https://example.test/v1beta', models: [{ id: 'm' }] }, true)).toEqual([
      { op: 'set', path: ['providers', 'google', 'hostedTools', 'enabled'], value: false },
    ])
  })

  it('allows an edit to keep the existing write-only credential', () => {
    const draft = {
      ...initialProviderDraft(),
      route: 'gateway',
      baseURL: 'https://example.test/v1',
      models: [{ id: 'model-a' }],
    }
    expect(validateProviderDraft(draft, [], { requireApiKey: false })).toBeUndefined()
  })

  it('rejects duplicate and invalid route identifiers before a wire call', () => {
    const draft = { ...initialProviderDraft(), route: 'Existing', displayName: 'X', baseURL: 'https://example.test', apiKey: 'X', modelId: 'm' }
    expect(validateProviderDraft(draft)).toMatchObject({ field: 'route' })
    expect(validateProviderDraft({ ...draft, route: 'existing' }, ['existing'])).toMatchObject({ field: 'route' })
  })

  it('writes only the hosted toggle and preserves advanced definitions', () => {
    expect(webSearchOps('gateway', {
      apiKeyEnv: 'KEY',
      baseURL: 'https://example.test/v1',
      models: [{ id: 'm' }],
      hostedTools: { enabled: true, definitions: [{ type: 'file_search', vector_store_ids: ['vs_1'] }] },
    }, false)).toEqual([
      { op: 'set', path: ['providers', 'gateway', 'hostedTools', 'enabled'], value: false },
    ])
    expect(webSearchOps('gateway', {
      apiKeyEnv: 'KEY',
      baseURL: 'https://example.test/v1',
      models: [{ id: 'm' }],
      hostedTools: { enabled: false, definitions: [{ type: 'file_search', vector_store_ids: ['vs_1'] }] },
    }, true)).toEqual([
      { op: 'set', path: ['providers', 'gateway', 'hostedTools', 'enabled'], value: true },
      { op: 'set', path: ['providers', 'gateway', 'hostedTools', 'definitions'], value: [{ type: 'file_search', vector_store_ids: ['vs_1'] }, { type: 'web_search' }] },
      { op: 'set', path: ['providers', 'gateway', 'hostedTools', 'toolChoice'], value: 'auto' },
    ])
    expect(hostedToolsFromToggle(true)).toEqual({ enabled: true, definitions: [{ type: 'web_search' }], toolChoice: 'auto' })
    expect(hostedToolsFromToggle(false)).toEqual({ enabled: false })
  })

  it('deletes only the selected Bridge route', () => {
    expect(providerDeleteOps('gateway')).toEqual([
      { op: 'unset', path: ['providers', 'gateway'] },
    ])
  })
})
