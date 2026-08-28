import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { WebBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { HostedWebSearchCard } from './HostedWebSearchCard.tsx'
import { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts'
import type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts'
export { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts'
export type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'bridge-hosted-web-search': HostedWebSearchChatData
  }
}

type HostedWebSearchNodeProps = PropsRuntime<
  'conversation.chat.node',
  'bridge-hosted-web-search'
> & PropsLocale<'conversation'>

export function HostedWebSearchNodeView({
  node, t,
}: HostedWebSearchNodeProps) {
  const labels: WebBlockLabels = {
    noResults: t('web.noResults'),
    sourcesTruncated: t('web.sourcesTruncated'),
    http: t('web.http'),
    contentTruncated: t('web.contentTruncated'),
    markdown: {
      code: { copyLabel: t('copy'), copiedLabel: t('copied') },
      footnotes: t('markdown.footnotes'),
    },
  }
  return <HostedWebSearchCard data={node.data} labels={labels} />
}

/** Register the durable assembler Definition and its keyed chat renderer. */
export function registerHostedWebSearchConversationNode(ctx: Context): void {
  const uiConversation = ctx.get('uiConversation') as {
    events: { register: (definition: typeof hostedWebSearchDefinition) => unknown }
  }
  uiConversation.events.register(hostedWebSearchDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'bridge-hosted-web-search',
    locale: 'conversation',
  }, HostedWebSearchNodeView))
}
