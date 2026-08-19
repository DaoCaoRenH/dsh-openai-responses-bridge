import { describe, expect, it } from 'vitest'
import { hostedWebSearchDefinition } from '../src/client/HostedWebSearchDefinition.ts'
import type { HostedWebSearchState } from '../src/hosted-web-search/events.ts'

function state(status: HostedWebSearchState['status']): HostedWebSearchState {
  return {
    version: 1,
    searchId: 'search_node_1',
    turn: 1,
    step: 2,
    provider: 'gateway',
    model: 'bridge-model',
    responseId: 'response_1',
    status,
    queries: ['latest DSH release'],
    sources: [{ url: 'https://example.test/dsh', title: 'DSH' }],
    citations: [{ url: 'https://example.test/dsh', title: 'DSH', startIndex: 0, endIndex: 6 }],
  }
}

describe('hosted web_search Conversation Node', () => {
  it('matches Bridge events and materializes a dedicated search card node', () => {
    const startState = state('searching')
    const event = {
      type: 'bridge/hosted-web-search/start' as const,
      seq: 11,
      time: 1,
      data: startState,
    }
    expect(hostedWebSearchDefinition.match(event as never)).toEqual({ id: 'search_node_1', role: 'start' })

    const match = {
      event,
      view: undefined,
      role: 'start' as const,
      location: { kind: 'unresolved' as const },
    }
    const node = hostedWebSearchDefinition.buildViewNode?.({
      key: 'bridge-hosted-web-search:search_node_1',
      kind: 'bridge-hosted-web-search',
      id: 'search_node_1',
      matches: [match],
      start: match,
      state: startState,
      current: new Map(),
    } as never)

    expect(node).toMatchObject({
      kind: 'bridge-hosted-web-search',
      target: 'chat',
      id: 'search_node_1',
      data: {
        status: 'searching',
        queries: ['latest DSH release'],
        sources: [{ url: 'https://example.test/dsh' }],
      },
    })
    expect(node?.kind).not.toBe('tool-call')
  })

  it('folds update and end events into the same search identity', () => {
    const start = state('in_progress')
    const update = state('searching')
    const end = state('completed')
    const startEvent = { type: 'bridge/hosted-web-search/start' as const, seq: 1, time: 1, data: start }
    const updateEvent = { type: 'bridge/hosted-web-search/update' as const, seq: 2, time: 2, data: update }
    const endEvent = { type: 'bridge/hosted-web-search/end' as const, seq: 3, time: 3, data: end }
    expect(hostedWebSearchDefinition.match(updateEvent as never)).toEqual({ id: 'search_node_1', role: 'update' })
    expect(hostedWebSearchDefinition.match(endEvent as never)).toEqual({ id: 'search_node_1', role: 'update' })

    const startMatch = { event: startEvent, view: undefined, role: 'start' as const, location: { kind: 'unresolved' as const } }
    const endMatch = { event: endEvent, view: undefined, role: 'update' as const, location: { kind: 'unresolved' as const } }
    const final = hostedWebSearchDefinition.update?.({
      key: 'bridge-hosted-web-search:search_node_1',
      kind: 'bridge-hosted-web-search',
      id: 'search_node_1',
      matches: [startMatch, endMatch],
      start: startMatch,
      state: update,
      current: new Map(),
    } as never, endMatch)
    expect(final).toEqual(end)
  })
})
