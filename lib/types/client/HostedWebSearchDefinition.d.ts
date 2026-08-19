import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client';
import type { HostedWebSearchState } from '../hosted-web-search/events.ts';
export type HostedWebSearchChatData = Pick<HostedWebSearchState, 'provider' | 'model' | 'status' | 'queries' | 'sources' | 'citations' | 'truncated' | 'error'>;
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ChatNodeDataMap {
        /** A Bridge-hosted Responses web-search lifecycle, not a local tool row. */
        'bridge-hosted-web-search': HostedWebSearchChatData;
    }
}
export declare const hostedWebSearchDefinition: ConversationNodeDefinition<HostedWebSearchState>;
