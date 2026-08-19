import type { Context } from '@deepseek-ai/cordis';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
export { hostedWebSearchDefinition } from './HostedWebSearchDefinition.ts';
export type { HostedWebSearchChatData } from './HostedWebSearchDefinition.ts';
export declare function HostedWebSearchNodeView({ node }: ChatNodeViewProps<'bridge-hosted-web-search'>): import("react").JSX.Element;
/** Register the durable assembler Definition and its keyed chat renderer. */
export declare function registerHostedWebSearchConversationNode(ctx: Context): void;
