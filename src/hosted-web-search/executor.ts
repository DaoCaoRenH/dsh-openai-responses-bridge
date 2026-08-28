import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from 'openai/resources/responses/responses.js'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  HostedToolsConfig,
  OpenAIResponsesTool,
} from '../types.ts'
import type {
  HostedWebSearchSource,
  HostedWebSearchState,
} from './events.ts'
import { HostedWebSearchObserver } from './normalize.ts'
import { activeTurnStep, appendHostedWebSearchCheckpoint } from './session.ts'
import { createResponsesClient } from './transport.ts'

const MAX_QUERIES = 4
const MAX_SOURCES = 8
const SEARCH_TOOL_TYPES = new Set(['web_search', 'web_search_preview'])

export interface HostedWebSearchExecutorOptions {
  model: Model<Api>
  apiKey: string
  hostedTools: HostedToolsConfig
  session?: Session
  searchIdPrefix?: string
  signal: AbortSignal
}

export interface HostedWebSearchResult {
  content?: string
  sources: Array<{
    url: string
    title?: string
    snippet?: string
    publishedAt?: string
  }>
  truncated: boolean
}

interface QueryResult {
  query: string
  content?: string
  sources: HostedWebSearchSource[]
  truncated: boolean
}

type RecordValue = Record<string, unknown>

function recordOf(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hostedSearchDefinitions(hosted: HostedToolsConfig): OpenAIResponsesTool[] {
  const definitions = hosted.definitions ?? [{ type: 'web_search' }]
  return definitions
    .filter(definition => SEARCH_TOOL_TYPES.has(definition.type))
    .map(definition => ({ ...definition }))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function parseQueries(args: unknown): string[] {
  const record = recordOf(args)
  const raw = record?.queries
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('web_search requires a non-empty queries array')
  }
  const queries: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error('web_search queries must contain only non-empty strings')
    }
    const query = item.trim()
    if (!queries.includes(query)) queries.push(query)
  }
  if (queries.length > MAX_QUERIES) throw new Error(`web_search accepts at most ${MAX_QUERIES} unique queries`)
  return queries
}

function textFromResponse(value: unknown): string | undefined {
  const response = recordOf(value)
  const output = Array.isArray(response?.output) ? response.output : []
  const chunks: string[] = []
  for (const outputValue of output) {
    const item = recordOf(outputValue)
    if (item?.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const contentValue of content) {
      const contentItem = recordOf(contentValue)
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') chunks.push(contentItem.text)
    }
  }
  return chunks.length === 0 ? undefined : chunks.join('')
}

function terminalError(value: unknown): string | undefined {
  const event = recordOf(value)
  const response = recordOf(event?.response)
  const error = recordOf(event?.error) ?? recordOf(response?.error)
  if (typeof error?.message === 'string' && error.message.length > 0) return error.message
  if (typeof event?.message === 'string' && event.message.length > 0) return event.message
  return undefined
}

function sourceForCanonical(source: HostedWebSearchSource): HostedWebSearchResult['sources'][number] {
  return {
    url: source.url,
    ...source.title === undefined ? {} : { title: source.title },
    ...source.snippet === undefined ? {} : { snippet: source.snippet },
    ...source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt },
  }
}

function sourceStates(states: readonly HostedWebSearchState[]): HostedWebSearchSource[] {
  const result: HostedWebSearchSource[] = []
  const seen = new Set<string>()
  for (const state of states) {
    for (const source of state.sources) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      result.push(source)
    }
  }
  return result
}

function mergeQueryResults(results: readonly QueryResult[]): HostedWebSearchResult {
  const sources: HostedWebSearchResult['sources'] = []
  const seen = new Set<string>()
  let truncated = results.some(result => result.truncated)
  for (const result of results) {
    for (const source of result.sources) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      if (sources.length >= MAX_SOURCES) {
        truncated = true
        continue
      }
      sources.push(sourceForCanonical(source))
    }
  }
  const contentParts = results
    .filter(result => result.content !== undefined && result.content.length > 0)
    .map(result => results.length === 1 ? result.content as string : `### ${result.query}\n\n${result.content}`)
  return {
    ...contentParts.length === 0 ? {} : { content: contentParts.join('\n\n') },
    sources,
    truncated,
  }
}

async function executeOne(
  query: string,
  index: number,
  options: HostedWebSearchExecutorOptions,
  signal: AbortSignal,
): Promise<QueryResult> {
  const location = options.session === undefined ? { turn: 0, step: 0 } : activeTurnStep(options.session)
  let checkpointQueue = Promise.resolve()
  const observer = new HostedWebSearchObserver({
    provider: String(options.model.provider),
    model: options.model.id,
    ...location,
    queries: [query],
    ...options.searchIdPrefix === undefined ? {} : { idPrefix: `${options.searchIdPrefix}:${index}` },
    onCheckpoint: (kind, state) => {
      checkpointQueue = checkpointQueue.then(() => {
        appendHostedWebSearchCheckpoint(
          options.session,
          `bridge/hosted-web-search/${kind}` as 'bridge/hosted-web-search/start' | 'bridge/hosted-web-search/update' | 'bridge/hosted-web-search/end',
          state,
        )
      })
    },
  })
  const definitions = hostedSearchDefinitions(options.hostedTools)
  if (definitions.length === 0) throw new Error('Bridge hosted web_search has no web_search definition')
  const include = uniqueStrings([
    ...(options.hostedTools.include ?? []),
    'web_search_call.action.sources',
  ])
  const params = {
    model: options.model.id,
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: `Search the web for: ${query}` }],
    }],
    tools: definitions,
    tool_choice: options.hostedTools.toolChoice ?? 'auto',
    ...include.length === 0 ? {} : { include },
    stream: true,
    store: false,
  } as unknown as ResponseCreateParamsStreaming

  let deltaText = ''
  let fallbackText: string | undefined
  let terminal: 'completed' | 'failed' | undefined
  try {
    if (signal.aborted) throw new Error('Hosted web search request aborted')
    const client = createResponsesClient(options.model, { apiKey: options.apiKey })
    const { data } = await client.responses.create(params, {
      signal,
      maxRetries: 0,
    }).withResponse()
    for await (const raw of data as AsyncIterable<ResponseStreamEvent>) {
      if (signal.aborted) throw new Error('Hosted web search request aborted')
      const event = recordOf(raw)
      const type = typeof event?.type === 'string' ? event.type : ''
      if (type === 'response.output_text.delta' && typeof event?.delta === 'string') deltaText += event.delta
      if (type === 'response.completed' || type === 'response.incomplete') {
        fallbackText = textFromResponse(event?.response) ?? fallbackText
        terminal = type === 'response.completed' ? 'completed' : 'failed'
        if (terminal === 'failed') throw new Error(terminalError(raw) ?? 'Hosted web search response was incomplete')
      } else if (type === 'response.failed' || type === 'error') {
        terminal = 'failed'
        throw new Error(terminalError(raw) ?? 'Hosted web search response failed')
      }
      observer.observe(raw)
    }
    if (terminal === undefined) {
      observer.finish('failed', { message: 'Responses stream ended before a terminal event', code: 'STREAM_INCOMPLETE' })
      throw new Error('Hosted web search response ended before a terminal event')
    }
    observer.finish('completed')
  } catch (error: unknown) {
    observer.finish(signal.aborted ? 'aborted' : 'failed', {
      message: signal.aborted ? 'Hosted web search request aborted' : errorMessage(error),
      code: signal.aborted ? 'ABORTED' : 'RESPONSES_ERROR',
    })
    throw error
  } finally {
    await checkpointQueue
  }

  const states = observer.states()
  const sources = sourceStates(states)
  return {
    query,
    ...deltaText.length > 0 ? { content: deltaText } : fallbackText === undefined ? {} : { content: fallbackText },
    sources: sources.slice(0, MAX_SOURCES),
    truncated: states.some(state => state.truncated === true) || sources.length > MAX_SOURCES,
  }
}

/** Execute the same hosted Responses search used by normal mode for a PTC call. */
export async function executeHostedWebSearch(
  args: unknown,
  options: HostedWebSearchExecutorOptions,
): Promise<HostedWebSearchResult> {
  const queries = parseQueries(args)
  if (queries.length === 1) return mergeQueryResults([await executeOne(queries[0] as string, 0, options, options.signal)])

  const controller = new AbortController()
  const signal = AbortSignal.any([options.signal, controller.signal])
  const results: QueryResult[] = []
  let firstFailure: unknown
  const tasks = queries.map(async (query, index) => {
    try {
      results[index] = await executeOne(query, index, options, signal)
    } catch (error: unknown) {
      if (firstFailure === undefined) firstFailure = error
      if (!controller.signal.aborted) controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(tasks)
  if (firstFailure !== undefined) throw firstFailure
  return mergeQueryResults(results)
}
