/**
 * Bridge adaptation of DSH's native model-list editor.
 *
 * The interaction is intentionally the same as the native CustomProviderCard:
 * model rows stay compact, advanced fields are disclosed per row, and model
 * discovery opens a picker instead of silently writing settings. The row type
 * is BridgeModelProfile, so Bridge input modalities are retained instead of
 * being reduced to pi-ai's generic record shape. Reasoning is not user-editable
 * here; every new model receives Bridge's fixed dispatch map.
 */
import type { ReactNode } from 'react';
import type { BridgeKey } from './locales.ts';
import type { BridgeModelDraft } from './modelFields.ts';
import type { BridgeLlmRemote } from './remote.ts';
export interface BridgeProbeTarget {
    settingsNs: string;
    provider?: string;
    baseURL?: string;
    api?: string;
    apiKey?: string;
}
export interface BridgeModelListEditorProps {
    models: readonly BridgeModelDraft[];
    onChange: (models: BridgeModelDraft[]) => void;
    probe: BridgeProbeTarget;
    probeBlocked?: string;
    api: Pick<{
        llm: BridgeLlmRemote;
    }, 'llm'>;
    t: (key: BridgeKey) => string;
    disabled: boolean;
}
/** Render Bridge model rows and the OpenAI-compatible /models picker. */
export declare function BridgeModelListEditor({ models, onChange, probe, probeBlocked, api, t, disabled, }: BridgeModelListEditorProps): ReactNode;
