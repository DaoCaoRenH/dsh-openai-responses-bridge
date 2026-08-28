import type { ReactNode } from 'react';
import type { BridgeKey } from './locales.ts';
import type { BridgeSettingsState, BridgeSettingsStore } from './store.ts';
import type { BridgeRemoteApi } from './remote.ts';
export interface BridgeSectionInjected {
    controller: BridgeSettingsStore;
    useSnapshot: <T>(selector: (state: BridgeSettingsState) => T) => T;
    api: BridgeRemoteApi;
    t: (key: BridgeKey) => string;
}
export type BridgeSectionProps = Partial<BridgeSectionInjected>;
/** Standalone settings section; it never renders inside native ModelsSection. */
export declare function BridgeSection(props: BridgeSectionProps): ReactNode;
