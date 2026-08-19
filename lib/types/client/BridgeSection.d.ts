import type { ReactNode } from 'react';
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client';
import type { BridgeKey } from './locales.ts';
import type { BridgeSettingsState, BridgeSettingsStore } from './store.ts';
export interface BridgeSectionInjected {
    controller: BridgeSettingsStore;
    useSnapshot: <T>(selector: (state: BridgeSettingsState) => T) => T;
    api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>;
    t: (key: BridgeKey) => string;
}
export type BridgeSectionProps = Partial<BridgeSectionInjected>;
/** Standalone settings section; it never renders inside native ModelsSection. */
export declare function BridgeSection(props: BridgeSectionProps): ReactNode;
