import { describe, expect, it, vi } from 'vitest'
import { applyPwshSandboxSchem, stripEscalationParams, type SandboxSchemaAssembly, type SandboxSchemaAssemblyContext } from '../src/pwshSandboxSchem.ts'

function assembly(): SandboxSchemaAssembly {
  return {
    sections: [],
    contexts: [],
    tools: [
      {
        name: 'bash',
        description: 'run a command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            sandbox_permissions: { type: 'string' },
            justification: { type: 'string' },
          },
          required: ['command', 'sandbox_permissions', 'justification'],
        },
      },
      {
        name: 'custom',
        description: 'keep custom tools unchanged',
        parameters: { sandbox_permissions: { type: 'string' } },
      },
    ],
    variables: {},
  }
}

function listenerFor(mode: string): (assembly: SandboxSchemaAssembly, context: SandboxSchemaAssemblyContext, next: () => Promise<SandboxSchemaAssembly>) => Promise<SandboxSchemaAssembly> {
  let listener: ((assembly: SandboxSchemaAssembly, context: SandboxSchemaAssemblyContext, next: () => Promise<SandboxSchemaAssembly>) => Promise<SandboxSchemaAssembly>) | undefined
  const ctx = {
    on: vi.fn((_event: string, candidate: typeof listener) => { listener = candidate }),
    get: vi.fn((name: string) => name === 'sandboxPolicy' ? { resolve: () => ({ mode }) } : undefined),
  }
  applyPwshSandboxSchem(ctx as never)
  if (listener === undefined) throw new Error('sandbox schema listener was not registered')
  return listener
}

describe('dsh-pwsh-sandbox-schem embedded in Bridge', () => {
  it('removes escalation properties and required entries copy-on-write', () => {
    const original = {
      type: 'object',
      properties: {
        command: { type: 'string' },
        sandbox_permissions: { type: 'string' },
        justification: { type: 'string' },
      },
      required: ['command', 'sandbox_permissions', 'justification'],
    }
    const result = stripEscalationParams(original) as Record<string, unknown>
    expect(result).toEqual({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    })
    expect(result).not.toBe(original)
    expect(original.properties).toHaveProperty('sandbox_permissions')
  })

  it('filters only targeted tools in danger-full-access', async () => {
    const original = assembly()
    const listener = listenerFor('danger-full-access')
    const result = await listener(original, { agent: { session: {} } as never }, async () => original)
    expect(result.tools[0]?.parameters).toEqual({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    })
    expect(result.tools[1]).toBe(original.tools[1])
    expect(original.tools[0]?.parameters).toHaveProperty('properties.sandbox_permissions')
  })

  it('leaves restricted sessions unchanged', async () => {
    const original = assembly()
    const listener = listenerFor('workspace-write')
    const result = await listener(original, { agent: { session: {} } as never }, async () => original)
    expect(result).toBe(original)
  })

  it('leaves assemblies without a session or policy unchanged', async () => {
    const original = assembly()
    const listener = listenerFor('danger-full-access')
    expect(await listener(original, {}, async () => original)).toBe(original)
  })
})
