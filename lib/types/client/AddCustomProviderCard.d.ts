import type { ReactNode } from 'react';
import type { BridgeProviderProfile } from '../types.ts';
import type { BridgeKey } from './locales.ts';
import type { BridgeRemoteApi, SettingsNamespaceView } from './remote.ts';
interface AddCustomProviderCardProps {
    namespace: SettingsNamespaceView;
    existingRoutes: readonly string[];
    writable: boolean;
    api: BridgeRemoteApi;
    t: (key: BridgeKey) => string;
    mode?: 'create' | 'edit';
    route?: string;
    profile?: BridgeProviderProfile;
    credentialConfigured?: boolean;
    onCancel: () => void;
    onSaved: () => void;
}
/** Native-shaped creation card whose persistence seam is owned by the Bridge. */
export declare function AddCustomProviderCard({ namespace, existingRoutes, writable, api, t, mode, route, profile: initialProfile, credentialConfigured, onCancel, onSaved, }: AddCustomProviderCardProps): ReactNode;
export {};
