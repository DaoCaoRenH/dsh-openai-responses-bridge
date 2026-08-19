import type { ReactNode } from 'react';
import type { CredentialView, IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client';
import type { BridgeProviderProfile } from '../types.ts';
import type { BridgeKey } from './locales.ts';
interface ProviderSummaryCardProps {
    route: string;
    profile: BridgeProviderProfile;
    credentialRef: string | undefined;
    credential: CredentialView | undefined;
    active: boolean;
    namespace: SettingsNamespaceView;
    writable: boolean;
    api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>;
    t: (key: BridgeKey) => string;
    onChanged: () => void;
}
/** Route summary with Bridge-owned edit, delete, and web_search actions. */
export declare function ProviderSummaryCard({ route, profile, credentialRef, credential, active, namespace, writable, api, t, onChanged, }: ProviderSummaryCardProps): ReactNode;
export {};
