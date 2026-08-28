import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { HostedWebSearchState } from '../hosted-web-search/events.ts';
export type HostedWebSearchChatData = Pick<HostedWebSearchState, 'provider' | 'model' | 'status' | 'queries' | 'sources' | 'citations' | 'truncated' | 'error'>;
export declare const hostedWebSearchDefinition: ConversationNodeDefinition<HostedWebSearchState>;
