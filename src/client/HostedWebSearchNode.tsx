import type { Context } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HostedWebSearchCard } from './HostedWebSearchCard.tsx'
import { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts'
export { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts'
export type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts'

export function HostedWebSearchNodeView({ node }: ChatNodeViewProps<'bridge-hosted-web-search'>) {
  return <HostedWebSearchCard data={node.data} />
}

/** Register the durable assembler Definition and its keyed chat renderer. */
export function registerHostedWebSearchConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(hostedWebSearchDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'bridge-hosted-web-search',
    locale: 'conversation',
  }, HostedWebSearchNodeView))
}
