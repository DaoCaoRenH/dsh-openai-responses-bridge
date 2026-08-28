import OpenAI from 'openai'
import type { Api, Model } from '@earendil-works/pi-ai'

export type SessionAffinityFormat = 'openai' | 'openai-nosession' | 'openrouter'

export interface ResponsesClientOptions {
  apiKey?: string
  headers?: Record<string, string | null>
  session?: string
}

interface ResponsesCompatOptions {
  sessionAffinityFormat?: SessionAffinityFormat
}

function hasHeader(headers: Record<string, string | null> | undefined, name: string): boolean {
  if (headers === undefined) return false
  const expected = name.toLowerCase()
  return Object.entries(headers).some(([key, value]) => key.toLowerCase() === expected && value !== null && value.trim().length > 0)
}

function apiKeyFor(model: Model<Api>, options: ResponsesClientOptions | undefined): string {
  if (options?.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
  if (hasHeader(options?.headers, 'authorization') || hasHeader(options?.headers, 'cf-aig-authorization')) return 'unused'
  throw new Error(`No API key for provider: ${model.provider}`)
}

function sessionAffinityFormat(model: Model<Api>): SessionAffinityFormat {
  const compat = model.compat as ResponsesCompatOptions | undefined
  if (compat?.sessionAffinityFormat !== undefined) return compat.sessionAffinityFormat
  return model.provider === 'openrouter' || model.baseUrl.includes('openrouter.ai') ? 'openrouter' : 'openai'
}

/** Create the OpenAI Responses client used by both normal and PTC hosted calls. */
export function createResponsesClient(model: Model<Api>, options?: ResponsesClientOptions): OpenAI {
  const headers: Record<string, string | null> = { ...model.headers }
  const affinity = sessionAffinityFormat(model)
  if (options?.session !== undefined) {
    if (affinity === 'openrouter') headers['x-session-id'] = options.session
    else if (affinity === 'openai') {
      headers.session_id = options.session
      headers['x-client-request-id'] = options.session
    } else headers['x-client-request-id'] = options.session
  }
  // A request-specific header must override model defaults and affinity headers,
  // matching the ordering of the native pi-ai Responses adapter.
  Object.assign(headers, options?.headers)
  return new OpenAI({
    apiKey: apiKeyFor(model, options),
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  })
}

/** Detach response headers before forwarding them to pi-ai callbacks. */
export function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries())
}
