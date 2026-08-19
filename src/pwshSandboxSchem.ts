import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** The model-facing tool shape produced by DSH's system-prompt assembler. */
export type SandboxSchemaTool = PromptAssembly['tools'][number]

/** The part of the prompt assembly used by this compatibility layer. */
export type SandboxSchemaAssembly = PromptAssembly

/** The per-assembly context needed to resolve the effective session mode. */
export type SandboxSchemaAssemblyContext = AssembleContext & { agent?: { session?: unknown } }

interface SandboxPolicyService {
  resolve(input: { session: unknown }): { mode: string }
}

const TARGET_TOOLS = new Set(['pwsh', 'bash', 'edit', 'write'])
const ESCALATION_PARAMS = new Set(['sandbox_permissions', 'justification'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Remove the two redundant escalation fields without mutating the original
 * schema. The helper supports both DSH's compiled JSON Schema and the flat
 * parameter-map shape used by a few compatible tool providers.
 */
export function stripEscalationParams(parameters: unknown): unknown {
  if (!isObject(parameters)) return parameters

  const properties = parameters.properties
  if (isObject(properties)) {
    let changed = false
    const nextProperties = { ...properties }
    for (const key of ESCALATION_PARAMS) {
      if (Object.hasOwn(nextProperties, key)) {
        delete nextProperties[key]
        changed = true
      }
    }
    if (!changed) return parameters

    const required = parameters.required
    const nextRequired = Array.isArray(required)
      ? required.filter(entry => typeof entry !== 'string' || !ESCALATION_PARAMS.has(entry))
      : required
    return {
      ...parameters,
      properties: nextProperties,
      ...(nextRequired === undefined ? {} : { required: nextRequired }),
    }
  }

  let changed = false
  const copy = { ...parameters }
  for (const key of ESCALATION_PARAMS) {
    if (Object.hasOwn(copy, key)) {
      delete copy[key]
      changed = true
    }
  }
  return changed ? copy : parameters
}

/**
 * Install the sandbox schema compatibility behavior inside the Bridge bundle.
 * It only changes what the model sees; execution authority and approval remain
 * owned by DSH's native sandbox services.
 */
export function applyPwshSandboxSchem(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (
    _assembly: SandboxSchemaAssembly,
    context: SandboxSchemaAssemblyContext,
    next: () => Promise<SandboxSchemaAssembly>,
  ): Promise<SandboxSchemaAssembly> => {
    return next().then(assembled => {
      const session = context.agent?.session
      if (session === undefined) return assembled

      const policy = ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
      if (policy === undefined) return assembled
      if (policy.resolve({ session }).mode !== 'danger-full-access') return assembled

      let changed = false
      const tools = assembled.tools.map(tool => {
        if (!TARGET_TOOLS.has(tool.name)) return tool
        const parameters = stripEscalationParams(tool.parameters)
        if (parameters === tool.parameters) return tool
        changed = true
        return { ...tool, parameters: parameters as Record<string, unknown> }
      })
      return changed ? { ...assembled, tools } : assembled
    })
  })
}
