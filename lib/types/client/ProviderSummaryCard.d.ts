import type { ReactNode } from 'react';
import type { BridgeProviderProfile } from '../types.ts';
import type { BridgeKey } from './locales.ts';
import type { BridgeRemoteApi, CredentialInfo, SettingsNamespaceView } from './remote.ts';
interface ProviderSummaryCardProps {
    route: string;
    profile: BridgeProviderProfile;
    credentialRef: string | undefined;
    credential: CredentialInfo | undefined;
    active: boolean;
    namespace: SettingsNamespaceView;
    writable: boolean;
    api: BridgeRemoteApi;
    t: (key: BridgeKey) => string;
    onChanged: () => void;
}
/** Route summary with Bridge-owned edit, delete, and web_search actions. */
export declare function ProviderSummaryCard({ route, profile, credentialRef, credential, active, namespace, writable, api, t, onChanged, }: ProviderSummaryCardProps): ReactNode;
export {};
