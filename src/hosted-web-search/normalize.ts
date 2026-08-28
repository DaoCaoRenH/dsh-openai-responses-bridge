import type {
  HostedWebSearchCitation,
  HostedWebSearchError,
  HostedWebSearchSource,
  HostedWebSearchState,
  HostedWebSearchStatus,
} from './events.ts'

const MAX_QUERY_LENGTH = 512
const MAX_URL_LENGTH = 2_048
const MAX_TITLE_LENGTH = 512
const MAX_SNIPPET_LENGTH = 2_000
const MAX_PUBLISHER_LENGTH = 256
const MAX_PUBLISHED_AT_LENGTH = 128
const MAX_SOURCES = 100
const MAX_CITATIONS = 100

type RecordValue = Record<string, unknown>

function recordOf(value: unknown): RecordValue | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : undefined
}

function stringOf(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const valueTrimmed = value.trim()
  return valueTrimmed.length === 0 ? undefined : valueTrimmed.slice(0, maxLength)
}

function integerOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function httpUrlOf(value: unknown): string | undefined {
  const url = stringOf(value, MAX_URL_LENGTH)
  if (url === undefined) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

function statusOf(value: unknown): HostedWebSearchStatus | undefined {
  if (value === 'in_progress' || value === 'searching' || value === 'completed' || value === 'failed' || value === 'aborted') return value
  if (value === 'cancelled' || value === 'canceled') return 'aborted'
  return undefined
}

function statusFromEventType(type: string): HostedWebSearchStatus | undefined {
  const suffix = type.split('.').at(-1)
  return statusOf(suffix)
}

function idOf(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = stringOf(value, 256)
    if (result !== undefined) return result
  }
  return undefined
}

function queryValues(...values: unknown[]): string[] {
  const result: string[] = []
  const add = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) add(item)
      return
    }
    const query = stringOf(value, MAX_QUERY_LENGTH)
    if (query !== undefined && !result.includes(query)) result.push(query)
  }
  for (const value of values) add(value)
  return result
}

function sourceOf(value: unknown): HostedWebSearchSource | undefined {
  const source = recordOf(value)
  if (source === undefined) return undefined
  const url = httpUrlOf(source.url ?? source.link ?? source.href ?? source.source_url)
  if (url === undefined) return undefined
  const id = idOf(source.id, source.source_id)
  const title = stringOf(source.title ?? source.name ?? source.display_name, MAX_TITLE_LENGTH)
  const snippet = stringOf(source.snippet ?? source.description ?? source.excerpt ?? source.text, MAX_SNIPPET_LENGTH)
  const publisher = stringOf(source.publisher ?? source.site_name ?? source.domain, MAX_PUBLISHER_LENGTH)
  const publishedAt = stringOf(source.publishedAt ?? source.published_at ?? source.page_age, MAX_PUBLISHED_AT_LENGTH)
  return {
    ...id === undefined ? {} : { id },
    url,
    ...title === undefined ? {} : { title },
    ...snippet === undefined ? {} : { snippet },
    ...publisher === undefined ? {} : { publisher },
    ...publishedAt === undefined ? {} : { publishedAt },
  }
}

function sourceValues(...values: unknown[]): HostedWebSearchSource[] {
  const result: HostedWebSearchSource[] = []
  const byUrl = new Map<string, number>()
  const add = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) add(item)
      return
    }
    const source = sourceOf(value)
    if (source === undefined || result.length >= MAX_SOURCES) return
    const existingIndex = byUrl.get(source.url)
    if (existingIndex === undefined) {
      byUrl.set(source.url, result.length)
      result.push(source)
      return
    }
    const existing = result[existingIndex]
    if (existing === undefined) return
    result[existingIndex] = {
      ...existing,
      ...source.title === undefined || existing.title !== undefined ? {} : { title: source.title },
      ...source.snippet === undefined || existing.snippet !== undefined ? {} : { snippet: source.snippet },
      ...source.publisher === undefined || existing.publisher !== undefined ? {} : { publisher: source.publisher },
      ...source.publishedAt === undefined || existing.publishedAt !== undefined ? {} : { publishedAt: source.publishedAt },
    }
  }
  for (const value of values) add(value)
  return result
}

function citationOf(value: unknown): HostedWebSearchCitation | undefined {
  const annotation = recordOf(value)
  if (annotation === undefined || annotation.type !== 'url_citation') return undefined
  const url = httpUrlOf(annotation.url)
  if (url === undefined) return undefined
  const title = stringOf(annotation.title, MAX_TITLE_LENGTH)
  const quotedText = stringOf(annotation.quoted_text ?? annotation.quotedText ?? annotation.cited_text, MAX_SNIPPET_LENGTH)
  const startIndex = integerOf(annotation.start_index ?? annotation.startIndex)
  const endIndex = integerOf(annotation.end_index ?? annotation.endIndex)
  return {
    url,
    ...title === undefined ? {} : { title },
    ...startIndex === undefined ? {} : { startIndex },
    ...endIndex === undefined ? {} : { endIndex },
    ...quotedText === undefined ? {} : { quotedText },
  }
}

function citationValues(value: unknown): HostedWebSearchCitation[] {
  const result: HostedWebSearchCitation[] = []
  const seen = new Set<string>()
  const add = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) add(child)
      return
    }
    const citation = citationOf(item)
    if (citation === undefined) return
    const key = JSON.stringify(citation)
    if (seen.has(key) || result.length >= MAX_CITATIONS) return
    seen.add(key)
    result.push(citation)
  }
  add(value)
  return result
}

function annotationsOf(value: unknown): HostedWebSearchCitation[] {
  const item = recordOf(value)
  if (item === undefined) return []
  const content = Array.isArray(item.content) ? item.content : []
  const result: HostedWebSearchCitation[] = []
  for (const contentItem of content) {
    const contentRecord = recordOf(contentItem)
    if (contentRecord !== undefined) result.push(...citationValues(contentRecord.annotations))
  }
  return result
}

function fingerprint(state: HostedWebSearchState): string {
  return JSON.stringify(state)
}

interface SearchEntry {
  readonly id: string
  readonly outputIndex?: number
  readonly itemId?: string
  state: HostedWebSearchState
  lastFingerprint: string
  ended: boolean
}

export interface HostedWebSearchObserverOptions {
  provider: string
  model: string
  turn: number
  step: number
  /** Query text supplied by a PTC caller when the provider omits it in SSE. */
  queries?: string[]
  responseId?: string
  /** Optional prefix that keeps concurrent PTC search identities distinct. */
  idPrefix?: string
  onCheckpoint: (
    kind: 'start' | 'update' | 'end',
    state: HostedWebSearchState,
  ) => void
}

/**
 * Observe raw OpenAI Responses events without taking ownership of Pi's parser.
 * Unknown provider fields/events are ignored; all durable output is bounded,
 * URL-validated, and free of request headers or payloads.
 */
export class HostedWebSearchObserver {
  private readonly entries = new Map<string, SearchEntry>()
  private readonly outputIndex = new Map<number, SearchEntry>()
  private readonly itemIds = new Map<string, SearchEntry>()
  private responseId: string | undefined
  private sequence = 0
  private responseTerminal = false
  private pendingCitations: HostedWebSearchCitation[] = []

  constructor(private readonly options: HostedWebSearchObserverOptions) {
    this.responseId = options.responseId
  }

  /** Consume one raw Responses event. This method never throws for malformed provider data. */
  observe(raw: unknown): void {
    try {
      this.observeUnsafe(raw)
    } catch {
      // Hosted presentation is best-effort. Pi's native stream must remain the
      // source of truth for text, reasoning, usage, errors, and replay.
    }
  }

  /** Finalize on normal parser completion or an abnormal stream close. */
  finish(reason: 'completed' | 'failed' | 'aborted' = 'failed', error?: HostedWebSearchError): void {
    if (!this.responseTerminal) {
      this.responseTerminal = true
      for (const entry of this.entries.values()) {
        if (!entry.ended) this.endEntry(entry, reason, error)
      }
      return
    }
    for (const entry of this.entries.values()) {
      if (!entry.ended) this.endEntry(entry, reason, error)
    }
  }

  /** Return detached final states for the hosted calls observed so far. */
  states(): HostedWebSearchState[] {
    return [...this.entries.values()].map(entry => ({
      ...entry.state,
      queries: [...entry.state.queries],
      sources: entry.state.sources.map(source => ({ ...source })),
      citations: entry.state.citations.map(citation => ({ ...citation })),
      ...entry.state.error === undefined ? {} : { error: { ...entry.state.error } },
    }))
  }

  private observeUnsafe(raw: unknown): void {
    const event = recordOf(raw)
    if (event === undefined) return
    const type = typeof event.type === 'string' ? event.type : ''
    this.sequence += 1

    if (type === 'response.created') {
      const response = recordOf(event.response)
      this.responseId = idOf(response?.id, event.response_id) ?? this.responseId
      this.updateResponseId()
      return
    }

    if (type === 'response.output_item.added') {
      const item = recordOf(event.item)
      if (this.isSearchItem(item)) {
        const entry = this.entryFor(event, item)
        this.applyItem(entry, item, event)
      } else if (item !== undefined) {
        this.applyAnnotations(this.entryForOutput(event.output_index), annotationsOf(item))
      }
      return
    }

    if (type === 'response.output_item.done') {
      const item = recordOf(event.item)
      if (this.isSearchItem(item)) {
        const entry = this.entryFor(event, item)
        this.applyItem(entry, item, event)
      } else if (item !== undefined) {
        this.applyAnnotations(this.entryForOutput(event.output_index), annotationsOf(item))
      }
      return
    }

    if (type === 'response.output_text.annotation.added' || type === 'response.output_text.annotation.delta') {
      const target = this.entryForOutput(event.output_index) ?? this.latestEntry()
      this.applyAnnotations(target, citationValues(event.annotation ?? event.annotations))
      return
    }

    if (type.startsWith('response.web_search_call.')) {
      const entry = this.entryFor(event)
      this.applyItem(entry, recordOf(event.item) ?? event, event)
      return
    }

    if (type === 'response.completed' || type === 'response.incomplete') {
      const response = recordOf(event.response)
      this.responseId = idOf(response?.id, event.response_id) ?? this.responseId
      const output = Array.isArray(response?.output) ? response.output : []
      for (const itemValue of output) {
        const item = recordOf(itemValue)
        if (this.isSearchItem(item)) {
          const entry = this.entryFor({}, item)
          this.applyItem(entry, item, response ?? {})
        } else if (item !== undefined) {
          this.applyAnnotations(this.latestEntry(), annotationsOf(item))
        }
      }
      this.responseTerminal = true
      const incomplete = response?.status === 'incomplete' || type === 'response.incomplete'
      const failed = response?.status === 'failed' || response?.status === 'cancelled' || response?.status === 'canceled'
      const responseStatus = incomplete || failed ? 'failed' : 'completed'
      const responseError = incomplete
        ? { message: 'Responses stream ended with an incomplete response', code: 'RESPONSE_INCOMPLETE' }
        : failed
          ? this.errorOf({}, response?.error) ?? { message: 'Responses stream ended with a failed response', code: 'RESPONSE_FAILED' }
          : undefined
      for (const entry of this.entries.values()) {
        if (!entry.ended) this.endEntry(entry, entry.state.status === 'failed' ? 'failed' : responseStatus, responseError)
      }
      return
    }

    if (type === 'response.failed' || type === 'error') {
      const error = this.errorOf(event, recordOf(event.response)?.error)
      this.responseTerminal = true
      for (const entry of this.entries.values()) {
        if (!entry.ended) this.endEntry(entry, 'failed', error)
      }
      return
    }
  }

  private isSearchItem(item: RecordValue | undefined): item is RecordValue {
    return item?.type === 'web_search_call' || item?.type === 'web_search_preview'
  }

  private entryFor(event: RecordValue, item?: RecordValue): SearchEntry {
    const action = recordOf(item?.action) ?? recordOf(event.action)
    const eventType = typeof event.type === 'string' ? event.type : ''
    const outputIndex = integerOf(event.output_index)
    const itemId = idOf(event.item_id, event.call_id, event.search_id, event.search_call_id, event.id, item?.id)
    const rawId = itemId
      ?? (outputIndex === undefined ? undefined : `bridge-search-${this.responseId ?? 'response'}-${outputIndex}`)
      ?? `bridge-search-${this.responseId ?? 'response'}-${this.sequence}`
    const id = this.options.idPrefix === undefined ? rawId : `${this.options.idPrefix}:${rawId}`
    const existing = this.entries.get(id)
    if (existing !== undefined) return existing
    const truncated = booleanOf(action?.truncated ?? item?.truncated ?? event.truncated)
    const initial: HostedWebSearchState = {
      version: 1,
      searchId: id,
      turn: this.options.turn,
      step: this.options.step,
      provider: this.options.provider,
      model: this.options.model,
      ...this.responseId === undefined ? {} : { responseId: this.responseId },
      status: statusOf(item?.status) ?? statusOf(event.status) ?? statusFromEventType(eventType) ?? 'in_progress',
      queries: queryValues(this.options.queries, action?.query, action?.queries, item?.query, event.query),
      sources: sourceValues(action?.sources, item?.sources, event.sources),
      citations: [],
      ...truncated === undefined ? {} : { truncated },
    }
    const entry: SearchEntry = {
      id,
      ...outputIndex === undefined ? {} : { outputIndex },
      ...itemId === undefined ? {} : { itemId },
      state: initial,
      lastFingerprint: '',
      ended: false,
    }
    this.entries.set(id, entry)
    if (outputIndex !== undefined) this.outputIndex.set(outputIndex, entry)
    if (itemId !== undefined) this.itemIds.set(itemId, entry)
    this.emit(entry, 'start')
    if (this.pendingCitations.length > 0) {
      const pending = this.pendingCitations
      this.pendingCitations = []
      this.applyAnnotations(entry, pending)
    }
    return entry
  }

  private entryForOutput(value: unknown): SearchEntry | undefined {
    const outputIndex = integerOf(value)
    return outputIndex === undefined ? undefined : this.outputIndex.get(outputIndex)
  }

  private latestEntry(): SearchEntry | undefined {
    return [...this.entries.values()].at(-1)
  }

  private applyItem(entry: SearchEntry, item: RecordValue, event: RecordValue): void {
    const action = recordOf(item.action) ?? recordOf(event.action)
    const nextStatus = statusOf(item.status) ?? statusOf(event.status) ?? statusFromEventType(typeof event.type === 'string' ? event.type : '')
    const queries = queryValues(entry.state.queries, action?.query, action?.queries, item.query, event.query)
    const sources = sourceValues(entry.state.sources, action?.sources, item.sources, event.sources)
    const error = this.errorOf(event, item.error)
    const truncated = booleanOf(action?.truncated ?? item.truncated ?? event.truncated)
    const next: HostedWebSearchState = {
      ...entry.state,
      ...this.responseId === undefined ? {} : { responseId: this.responseId },
      ...nextStatus === undefined ? {} : { status: nextStatus },
      queries,
      sources,
      ...truncated === undefined ? {} : { truncated },
      ...error === undefined ? {} : { error },
    }
    this.replace(entry, next)
  }

  private applyAnnotations(entry: SearchEntry | undefined, citations: HostedWebSearchCitation[]): void {
    if (citations.length === 0) return
    if (entry === undefined) {
      const seen = new Set(this.pendingCitations.map(citation => JSON.stringify(citation)))
      for (const citation of citations) {
        const key = JSON.stringify(citation)
        if (seen.has(key) || this.pendingCitations.length >= MAX_CITATIONS) continue
        seen.add(key)
        this.pendingCitations.push(citation)
      }
      return
    }
    const seen = new Set(entry.state.citations.map(citation => JSON.stringify(citation)))
    const merged = [...entry.state.citations]
    for (const citation of citations) {
      const key = JSON.stringify(citation)
      if (seen.has(key) || merged.length >= MAX_CITATIONS) continue
      seen.add(key)
      merged.push(citation)
    }
    this.replace(entry, { ...entry.state, citations: merged })
  }

  private updateResponseId(): void {
    if (this.responseId === undefined) return
    for (const entry of this.entries.values()) {
      if (entry.state.responseId !== this.responseId) this.replace(entry, { ...entry.state, responseId: this.responseId })
    }
  }

  private replace(entry: SearchEntry, state: HostedWebSearchState): void {
    entry.state = state
    if (!entry.ended) this.emit(entry, 'update')
  }

  private emit(entry: SearchEntry, kind: 'start' | 'update' | 'end'): void {
    const nextFingerprint = fingerprint(entry.state)
    if (kind === 'update' && nextFingerprint === entry.lastFingerprint) return
    if (kind === 'end') entry.ended = true
    entry.lastFingerprint = nextFingerprint
    this.options.onCheckpoint(kind, entry.state)
  }

  private endEntry(entry: SearchEntry, status: 'completed' | 'failed' | 'aborted', error?: HostedWebSearchError): void {
    if (entry.ended) return
    const next: HostedWebSearchState = {
      ...entry.state,
      status,
      ...error === undefined ? {} : { error },
    }
    entry.state = next
    this.emit(entry, 'end')
  }

  private errorOf(event: RecordValue, responseError: unknown): HostedWebSearchError | undefined {
    const error = recordOf(event.error) ?? recordOf(responseError)
    if (error === undefined) return undefined
    const message = stringOf(error.message ?? error.detail ?? event.message, MAX_SNIPPET_LENGTH) ?? 'Hosted web search failed'
    const code = stringOf(error.code ?? error.type, 128)
    return { message, ...code === undefined ? {} : { code } }
  }
}
