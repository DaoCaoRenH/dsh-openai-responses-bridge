import type { BridgeCredentialsRemote, BridgeLlmRemote, BridgeSettingsRemote, CredentialInfo, SettingsNamespaceView } from './remote.ts';
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { BridgeProviderProfile } from '../types.ts';
/** A route row rendered by the Bridge settings section. */
export interface BridgeRouteRow {
    route: string;
    profile: BridgeProviderProfile;
    credentialRef: string | undefined;
    credential: CredentialInfo | undefined;
    active: boolean;
    displayName: string;
}
/** Browser state for one mounted settings section. */
export interface BridgeSettingsState {
    status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
    error: string | null;
    credentialError: string | null;
    writable: boolean;
    revision: number;
    namespace: SettingsNamespaceView | undefined;
    routes: readonly BridgeRouteRow[];
}
declare function messageOf(error: unknown): string;
/** Settings/credentials/LLM join owned by this one page. */
export declare class BridgeSettingsStore {
    private readonly api;
    readonly store: SnapshotStore<BridgeSettingsState>;
    private generation;
    constructor(api: {
        settings: BridgeSettingsRemote;
        credentials: Pick<BridgeCredentialsRemote, 'describe'>;
        llm: BridgeLlmRemote;
    });
    load(): Promise<void>;
    dispose(): void;
}
/** Refresh only after a section has been opened once. */
export declare function refreshIfLoaded(controller: BridgeSettingsStore): void;
/** Visible state helper kept pure for unit tests and future cards. */
export declare function routeWebSearchEnabled(row: BridgeRouteRow): boolean;
/** Read an existing route from the latest section snapshot. */
export declare function routeFromState(state: BridgeSettingsState, route: string): BridgeProviderProfile | undefined;
export { messageOf };
