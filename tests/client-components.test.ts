import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CredentialView, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
  Modal: ({ open, children }: { open: boolean; children?: ReactNode }) => open ? createElement('div', { role: 'dialog' }, children) : null,
  DisclosureRow: ({ title, collapsedContent, children }: { title: string; collapsedContent?: ReactNode; children?: ReactNode }) => createElement('div', null, title, collapsedContent, children),
  IconSearchOutline16: () => createElement('span'),
  StateDot: () => createElement('span'),
  WebBlock: () => createElement('div'),
}))

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T>(initial: T) => ({
    getSnapshot: () => initial,
    subscribe: () => () => undefined,
    update: () => undefined,
  }),
}))

import { AddCustomProviderCard } from '../src/client/AddCustomProviderCard.tsx'
import { HostedWebSearchCard } from '../src/client/HostedWebSearchCard.tsx'
import { ProviderSummaryCard } from '../src/client/ProviderSummaryCard.tsx'
import { BRIDGE_SETTINGS_NS } from '../src/client/fields.ts'

const t = (key: string): string => ({
  custom: '自定义',
  edit: '编辑',
  delete: '删除',
  deleteTitle: '删除 {provider}？',
  deleteDescription: '删除配置，保留已有凭据。',
  deleteDescriptionWithCredential: '删除配置和 API 密钥。',
  deleteConfirm: '删除 {provider}',
  deleting: '正在删除 {provider}…',
  active: '已生效',
  credentialConfigured: '凭据已配置',
  credentialMissing: '凭据未配置',
  credentialReadOnly: '凭据为只读',
  apiProtocol: 'API 协议',
  apiProtocolOpenAI: 'OpenAI Responses（Bridge）',
  apiProtocolGoogle: 'Google Generative AI',
  apiProtocolHint: 'OpenAI Bridge 协议',
  apiProtocolGoogleHint: 'Gemini 原生协议',
  baseURL: 'API 地址',
  baseURLHint: 'OpenAI endpoint',
  baseURLGoogleHint: 'Gemini endpoint',
  modelId: '模型 ID',
  apiKey: 'API 密钥',
  apiKeyHint: '密钥只会写入 DSH credentials，不会保存到普通设置或再次显示。',
  webSearch: '启用 web_search',
  webSearchHint: 'hosted search',
  webSearchGoogleHint: 'Google 不支持 hosted search',
  webSearchUnavailable: 'Google 不支持 web_search',
  toggleSaving: '更新中…',
  fetchModels: '获取可用模型',
  models: '模型目录',
  conflict: '冲突',
  noCredential: '无凭据',
  modelsHint: '模型目录',
  fetchModelsGoogleHint: 'Google 请手动填写模型',
}[key] ?? key)

function namespace(): SettingsNamespaceView {
  return {
    ns: BRIDGE_SETTINGS_NS,
    schema: {},
    value: { providers: {} },
    user: { providers: {} },
    applies: 'live',
    secrets: [],
    revision: 1,
  }
}

describe('Bridge provider summary card', () => {
  it('renders the custom route and web_search control without exposing key material', () => {
    const credential: CredentialView = { configured: true, source: 'file', writable: true }
    const markup = renderToStaticMarkup(createElement(ProviderSummaryCard, {
      route: 'custom-bridge',
      profile: {
        apiKeyEnv: 'BRIDGE_API_KEY',
        displayName: 'Custom Bridge',
        baseURL: 'https://example.test/v1',
        models: [{ id: 'gpt-5.6-luna' }],
        hostedTools: { enabled: false },
      },
      credentialRef: 'BRIDGE_API_KEY',
      credential,
      active: true,
      namespace: namespace(),
      writable: true,
      api: {
        settings: { mutate: async () => ({ result: { ok: true as const, value: namespace() } }) },
        credentials: { unset: async () => ({ result: { ok: true as const, value: {} } }) },
      } as never,
      t: t as never,
      onChanged: () => undefined,
    }))
    expect(markup).toContain('Custom Bridge')
    expect(markup).toContain('custom-bridge')
    expect(markup).toContain('编辑')
    expect(markup).toContain('删除')
    expect(markup).not.toContain('编辑提供方')
    expect(markup).toContain('启用 web_search')
    expect(markup).not.toContain('secret')
  })

  it('uses the native-shaped custom-provider form without showing an initial validation error', () => {
    const markup = renderToStaticMarkup(createElement(AddCustomProviderCard, {
      namespace: namespace(),
      existingRoutes: [],
      writable: true,
      api: {
        settings: { mutate: async () => ({ result: { ok: true as const, value: namespace() } }) },
        credentials: { set: async () => ({ result: { ok: true as const, value: {} } }) },
        llm: { discoverModels: async () => ({ result: { ok: true as const, value: { models: [] } } }) },
      } as never,
      t: t as never,
      onCancel: () => undefined,
      onSaved: () => undefined,
    }))
    expect(markup).toContain('OpenAI Responses')
    expect(markup).toContain('Google Generative AI')
    expect(markup).toContain('获取可用模型')
    expect(markup).toContain('API 密钥')
    expect(markup).not.toContain('默认推理强度')
    expect(markup).not.toContain('推理映射')
    expect(markup).not.toContain('新 API 密钥')
    expect(markup).not.toContain('已有 credential reference')
    expect(markup).not.toContain('兼容模式')
    expect(markup).not.toContain('Provider ID 需以小写字母开头')
  })

  it('renders the Google protocol selection and disables Bridge hosted search', () => {
    const markup = renderToStaticMarkup(createElement(AddCustomProviderCard, {
      namespace: namespace(),
      existingRoutes: [],
      writable: true,
      api: {
        settings: { mutate: async () => ({ result: { ok: true as const, value: namespace() } }) },
        credentials: {
          set: async () => ({ result: { ok: true as const, value: {} } }),
        },
        llm: { discoverModels: async () => ({ result: { ok: true as const, value: { models: [] } } }) },
      } as never,
      t: t as never,
      mode: 'edit',
      route: 'google',
      profile: {
        api: 'google-generative-ai',
        apiKeyEnv: 'GOOGLE_KEY',
        baseURL: 'https://example.test/v1beta',
        models: [{ id: 'gemini-3.6-flash' }],
      },
      credentialConfigured: true,
      onCancel: () => undefined,
      onSaved: () => undefined,
    }))
    expect(markup).toContain('Google Generative AI')
    expect(markup).toContain('google-generative-ai')
    expect(markup).toContain('Google 不支持 hosted search')
    expect(markup).toContain('disabled=""')
  })
})

describe('Hosted web search card', () => {
  const data = {
    provider: 'gateway',
    model: 'bridge-model',
    status: 'completed' as const,
    queries: [] as string[],
    sources: [],
    citations: [],
  }

  it('does not repeat the status when the upstream search has no query', () => {
    const markup = renderToStaticMarkup(createElement(HostedWebSearchCard, { data }))
    expect(markup).toContain('Web Search OpenAI')
    expect(markup.match(/搜索完成/g)).toHaveLength(1)
  })

  it('shows the query alongside one terminal status', () => {
    const markup = renderToStaticMarkup(createElement(HostedWebSearchCard, {
      data: { ...data, queries: ['Prime Agent GitHub AI'] },
    }))
    expect(markup).toContain('Prime Agent GitHub AI')
    expect(markup.match(/搜索完成/g)).toHaveLength(1)
  })
})
