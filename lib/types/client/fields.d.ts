import type { BridgeApiProtocol, BridgeProviderProfile, HostedToolsConfig } from '../types.ts';
import type { BridgeModelDraft } from './modelFields.ts';
import type { JsonValue, SettingsNamespaceView, SettingsPathOpView } from './remote.ts';
/** The only settings namespace owned by the Bridge browser half. */
export declare const BRIDGE_SETTINGS_NS = "llm-openai-responses-bridge";
/** Convert a profile draft into the lossless JSON vocabulary of the Remote API. */
export declare function jsonValueOf(value: unknown): JsonValue;
export interface ProviderDraft {
    route: string;
    displayName: string;
    baseURL: string;
    api: BridgeApiProtocol;
    apiKey: string;
    models: BridgeModelDraft[];
    webSearch: boolean;
}
/** A new draft starts with an empty model list, like DSH's native card. */
export declare function initialProviderDraft(): ProviderDraft;
export interface DraftValidation {
    field: keyof ProviderDraft | 'models';
    message: string;
    index?: number;
}
/** Validate only facts the Bridge card owns before sending a Host mutation. */
export declare function validateProviderDraft(draft: ProviderDraft, existingRoutes?: Iterable<string>, options?: {
    requireApiKey?: boolean;
}): DraftValidation | undefined;
/** Derive the private DSH credential reference used for a newly created route. */
export declare function deriveApiKeyRef(route: string): string;
/** Build the new route without including the write-only API key value. */
export declare function providerProfileFromDraft(draft: ProviderDraft): BridgeProviderProfile;
/**
 * Rehydrate only the fields owned by the Bridge editor. Credentials remain
 * write-only, so an edit draft deliberately starts with an empty API-key box.
 */
export declare function providerDraftFromProfile(route: string, profile: BridgeProviderProfile): ProviderDraft;
/**
 * Build an edit patch without replacing the whole provider object. This keeps
 * settings owned by other Bridge surfaces (headers, retry policy, hosted tool
 * definitions, and so on) intact.
 */
export declare function providerEditOps(route: string, profile: BridgeProviderProfile, draft: ProviderDraft): SettingsPathOpView[];
/** Remove one Bridge route without rebuilding the rest of the namespace. */
export declare function providerDeleteOps(route: string): SettingsPathOpView[];
/** The exact hosted-tools object used when a new route is created. */
export declare function hostedToolsFromToggle(enabled: boolean): HostedToolsConfig;
/** Read one effective route profile from a redacted settings descriptor. */
export declare function providerAt(view: SettingsNamespaceView | undefined, route: string): BridgeProviderProfile | undefined;
/** Read the reference without ever asking the browser for its value. */
export declare function credentialRefOf(profile: BridgeProviderProfile | undefined): string | undefined;
/** Whether a route has opted into the remote Responses web search tool. */
export declare function webSearchEnabled(profile: BridgeProviderProfile | undefined): boolean;
/** Build minimal path operations for a summary-card web_search toggle. */
export declare function webSearchOps(route: string, profile: BridgeProviderProfile, enabled: boolean, api?: BridgeApiProtocol): SettingsPathOpView[];
/** Return only safe presentation fields used by the summary card. */
export declare function summaryOf(profile: BridgeProviderProfile): {
    baseURL: string;
    model: string;
};
