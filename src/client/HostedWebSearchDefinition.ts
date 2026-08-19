import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { HostedWebSearchState } from '../hosted-web-search/events.ts'

export type HostedWebSearchChatData = Pick<
  HostedWebSearchState,
  'provider' | 'model' | 'status' | 'queries' | 'sources' | 'citations' | 'truncated' | 'error'
>

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** A Bridge-hosted Responses web-search lifecycle, not a local tool row. */
    'bridge-hosted-web-search': HostedWebSearchChatData
  }
}

function viewData(state: HostedWebSearchState): HostedWebSearchChatData {
  return {
    provider: state.provider,
    model: state.model,
    status: state.status,
    queries: state.queries,
    sources: state.sources,
    citations: state.citations,
    ...state.truncated === undefined ? {} : { truncated: state.truncated },
    ...state.error === undefined ? {} : { error: state.error },
  }
}

function locationOf(context: ConversationNodeContext) {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' as const }
}

export const hostedWebSearchDefinition: ConversationNodeDefinition<HostedWebSearchState> = {
  kind: 'bridge-hosted-web-search',
  target: 'chat',
  match: (event) => {
    if (event.type === 'bridge/hosted-web-search/start') return { id: event.data.searchId, role: 'start' }
    if (event.type === 'bridge/hosted-web-search/update' || event.type === 'bridge/hosted-web-search/end') {
      return { id: event.data.searchId, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'bridge/hosted-web-search/start') throw new Error('hosted web search requires a start event')
    return match.event.data
  },
  update: (_context, match) => {
    if (match.event.type !== 'bridge/hosted-web-search/update' && match.event.type !== 'bridge/hosted-web-search/end') {
      throw new Error('unexpected hosted web search update')
    }
    return match.event.data
  },
  publication: match => match.event.type === 'bridge/hosted-web-search/end' ? 'immediate' : 'animation-frame',
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'bridge-hosted-web-search',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}
