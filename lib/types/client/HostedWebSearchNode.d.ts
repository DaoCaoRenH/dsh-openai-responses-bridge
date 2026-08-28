import type { Context } from '@deepseek-ai/cordis';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts';
export { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts';
export type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts';
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
    interface ChatNodeDataMap {
        'bridge-hosted-web-search': HostedWebSearchChatData;
    }
}
type HostedWebSearchNodeProps = PropsRuntime<'conversation.chat.node', 'bridge-hosted-web-search'> & PropsLocale<'conversation'>;
export declare function HostedWebSearchNodeView({ node, t, }: HostedWebSearchNodeProps): import("react").JSX.Element;
/** Register the durable assembler Definition and its keyed chat renderer. */
export declare function registerHostedWebSearchConversationNode(ctx: Context): void;
