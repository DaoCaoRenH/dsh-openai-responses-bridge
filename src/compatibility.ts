import type { HostedToolsConfig, JsonObject, OpenAIResponsesTool } from './types.ts'

/** True for a JSON object that can be copied without changing its prototype. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clone ordinary JSON-compatible data without retaining provider-owned references. */
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) result[key] = cloneJson(item)
  return result
}

function toolType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === 'string' ? value.type : undefined
}

function stableKey(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function hostedDefinitions(hosted: HostedToolsConfig): OpenAIResponsesTool[] {
  return hosted.definitions === undefined
    ? [{ type: 'web_search' }]
    : hosted.definitions.map(definition => cloneJson(definition) as OpenAIResponsesTool)
}

/** Whether this route has an enabled hosted web-search definition. */
export function hostedWebSearchEnabled(hosted?: HostedToolsConfig): boolean {
  if (hosted?.enabled !== true) return false
  return hostedDefinitions(hosted).some(definition => {
    const type = toolType(definition)
    return type === 'web_search' || type === 'web_search_preview'
  })
}

function isLocalWebSearchFunction(value: unknown): boolean {
  if (!isRecord(value)) return false
  const type = typeof value.type === 'string' ? value.type : undefined
  return (type === 'function' || type === 'custom') && value.name === 'web_search'
}

/**
 * Apply only the Bridge delta to a native pi-ai Responses payload.
 *
 * The payload has already been built by `openAIResponsesApi()`: message
 * conversion, reasoning replay, tool conversion, usage, and SSE processing all
 * remain in pi-ai. This function deliberately owns only the two Bridge
 * differences: third-party gateways reject `max_output_tokens`, and an opted-in
 * route may add the Responses hosted `web_search` tool.
 */
export function applyBridgeRequest(payload: unknown, hosted?: HostedToolsConfig): unknown {
  if (!isRecord(payload)) return payload
  const result = cloneJson(payload) as JsonObject
  delete result.max_output_tokens

  if (hosted?.enabled !== true) return result

  const definitions = hostedDefinitions(hosted)
  const hasWebSearch = definitions.some(definition => {
    const type = toolType(definition)
    return type === 'web_search' || type === 'web_search_preview'
  })
  const existingTools = Array.isArray(result.tools) ? result.tools : []
  const tools: unknown[] = []
  const seen = new Set<string>()
  for (const tool of [...existingTools, ...definitions]) {
    // DSH may expose a local Function Tool with the same public name. A
    // Responses hosted search is a different protocol object and must replace
    // that local executor only when the hosted definition is enabled. The off
    // path deliberately preserves the native function tool unchanged.
    if (hasWebSearch && isLocalWebSearchFunction(tool)) continue
    const key = stableKey(tool)
    if (seen.has(key)) continue
    seen.add(key)
    tools.push(tool)
  }
  result.tools = tools as JsonObject[keyof JsonObject]

  if (hosted.toolChoice !== undefined) result.tool_choice = cloneJson(hosted.toolChoice) as JsonObject[keyof JsonObject]
  else if (hasWebSearch && result.tool_choice === undefined) result.tool_choice = 'auto'

  const include = [
    ...(Array.isArray(result.include) ? result.include : []),
    ...(hosted.include ?? []),
    ...(hasWebSearch ? ['web_search_call.action.sources'] : []),
  ]
  if (include.length > 0) result.include = [...new Set(include)] as JsonObject[keyof JsonObject]

  return result
}
