/**
 * Bridge-owned Hosted Web Search facts.
 *
 * These are deliberately auxiliary, log-only events. They never enter the
 * DSH `tool/call` / `tool/result` lifecycle and therefore cannot be picked up
 * by the local tool executor. Each checkpoint is a complete value so a Client
 * Definition can replay it without retaining the raw SSE stream.
 */
export type HostedWebSearchStatus = 'in_progress' | 'searching' | 'completed' | 'failed' | 'aborted';
export interface HostedWebSearchSource {
    id?: string;
    url: string;
    title?: string;
    snippet?: string;
    publisher?: string;
    publishedAt?: string;
}
export interface HostedWebSearchCitation {
    url: string;
    title?: string;
    startIndex?: number;
    endIndex?: number;
    quotedText?: string;
}
export interface HostedWebSearchError {
    code?: string;
    message: string;
}
/** Lossless-JSON checkpoint written to the DSH session. */
export interface HostedWebSearchState {
    version: 1;
    searchId: string;
    turn: number;
    step: number;
    provider: string;
    model: string;
    responseId?: string;
    status: HostedWebSearchStatus;
    queries: string[];
    sources: HostedWebSearchSource[];
    citations: HostedWebSearchCitation[];
    truncated?: boolean;
    error?: HostedWebSearchError;
}
export type HostedWebSearchEventType = 'bridge/hosted-web-search/start' | 'bridge/hosted-web-search/update' | 'bridge/hosted-web-search/end';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** First complete checkpoint for one remote Responses web-search call. */
        'bridge/hosted-web-search/start': HostedWebSearchState;
        /** Complete intermediate checkpoint for one remote Responses web-search call. */
        'bridge/hosted-web-search/update': HostedWebSearchState;
        /** Complete terminal checkpoint for one remote Responses web-search call. */
        'bridge/hosted-web-search/end': HostedWebSearchState;
    }
}
