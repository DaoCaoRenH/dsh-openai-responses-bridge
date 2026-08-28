import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface LoadedBundle {
  id: string
  factory: (require: (id: string) => unknown) => Record<string, unknown>
}

describe('built DSH Client bundle composition', () => {
  it('loads through the ModuleLoader envelope and registers the standalone settings section', async () => {
    const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as {
      dsh?: { client?: { platform?: string; inject?: string[] } }
      exports?: Record<string, { default?: string }>
    }
    expect(packageJson.dsh?.client).toMatchObject({ platform: 'web' })
    expect(packageJson.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    expect(packageJson.exports?.['./client']?.default).toBe('./lib/client.js')

    const source = await readFile(resolve('lib/client.js'), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-client-web-react')
    expect(source).toContain('@deepseek-ai/dsh-client-store')
    expect(source).not.toContain('@deepseek-ai/dsh-client-runtime/client')
    let loaded: LoadedBundle | undefined
    const previousWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {
      __ModuleLoader__: { load: (entry: LoadedBundle) => { loaded = entry } },
    }
    try {
      new Function(source)()
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = previousWindow
    }
    expect(loaded?.id).toBe('dsh-openai-responses-bridge')
    const exported = loaded!.factory((id: string) => {
      if (id === '@deepseek-ai/dsh-client-store') return {
        createSnapshotStore: <T>(initial: T) => ({
          getSnapshot: () => initial,
          subscribe: () => () => undefined,
          update: () => undefined,
          set: () => undefined,
        }),
      }
      if (id === 'react') return {}
      if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Button: () => null, Modal: () => null }
      throw new Error(`unexpected client external: ${id}`)
    })
    expect(typeof exported.apply).toBe('function')

    const registrations: Array<{ options: { id?: string; key?: string; label?: () => string; locale?: string }; component: unknown }> = []
    const context = {
      get: (name: string) => name === 'uiConversation' ? {
        events: { register: () => () => undefined },
      } : undefined,
      locale: {
        register: () => undefined,
          bind: () => (key: string) => key === 'nav' ? '第三方模型' : key,
      },
      remote: {
        settings: { describe: async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } }) },
        credentials: { describe: async () => ({ ok: true, value: {} }) },
        llm: { listProviders: async () => ({ ok: true, value: [] }) },
        $on: () => () => undefined,
      },
      on: () => () => undefined,
      effect: (fn: () => unknown) => fn(),
      slots: {
        inject: (_name: string, factory: () => unknown) => { factory() },
        register: (options: { id?: string; key?: string; label?: () => string; locale?: string }, component: unknown) => {
          registrations.push({ options, component })
          return () => undefined
        },
      },
    }
    ;(exported.apply as (ctx: unknown) => void)(context)
    expect(registrations).toHaveLength(2)
    const settingsRegistration = registrations.find(entry => entry.options.id === 'openai-responses-bridge')
    const searchRegistration = registrations.find(entry => entry.options.key === 'bridge-hosted-web-search')
    expect(settingsRegistration?.options.label?.()).toBe('第三方模型')
    expect(searchRegistration?.options.locale).toBe('conversation')
  })
})
