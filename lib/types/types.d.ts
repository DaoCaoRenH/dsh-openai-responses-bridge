import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
/** JSON values accepted by a Responses payload or persisted hosted-tool setting. */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
    [key: string]: JsonValue;
}
/** Raw Responses tool definition. Unknown fields are preserved after validation. */
export interface OpenAIResponsesTool {
    type: string;
    [key: string]: unknown;
}
/** Responses `tool_choice` values supported by the settings schema. */
export type ResponsesToolChoice = 'none' | 'auto' | 'required' | JsonObject;
/** Hosted tool support mode for one route. */
export type HostedSourcePresentation = 'auto' | 'inline-only' | 'append';
/** Hosted tool settings owned by one bridge provider route. */
export interface HostedToolsConfig {
    enabled?: boolean;
    definitions?: OpenAIResponsesTool[];
    toolChoice?: ResponsesToolChoice;
    include?: string[];
    /** Persisted setting retained while native Pi owns citation presentation. */
    sourcePresentation?: HostedSourcePresentation;
    imageGeneration?: {
        enabled?: boolean;
        outputBackend?: 'dsh-attachment';
        maxBytes?: number;
    };
}
/** Default reasoning dispatch map for Bridge-declared models. */
export declare const DEFAULT_REASONING_EFFORTS: {
    readonly off: null;
    readonly low: "low";
    readonly medium: "medium";
    readonly high: "high";
    readonly xhigh: "xhigh";
    readonly max: "max";
};
/** Wire protocols owned by the Bridge settings namespace. */
export declare const BRIDGE_API_PROTOCOLS: readonly ["openai-responses", "google-generative-ai"];
export type BridgeApiProtocol = (typeof BRIDGE_API_PROTOCOLS)[number];
export declare const DEFAULT_BRIDGE_API: BridgeApiProtocol;
/** One model declared by a third-party Responses route. */
export interface BridgeModelProfile {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: Array<'text' | 'image'>;
    /** `false` disables reasoning; an object maps DSH levels to wire values. */
    reasoningEfforts?: false | Partial<Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>>;
}
/** One provider route in the bridge settings namespace. */
export interface BridgeProviderProfile {
    /** Native pi-ai wire implementation used by this route. */
    api?: BridgeApiProtocol;
    apiKeyEnv?: string;
    displayName?: string;
    baseURL?: string;
    models?: BridgeModelProfile[];
    reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    headers?: Record<string, string>;
    streamIdleTimeoutMs?: number;
    retryPolicy?: RetryPolicyConfig;
    hostedTools?: HostedToolsConfig;
}
/** Root settings section. Empty providers is intentionally a valid dormant state. */
export interface BridgeConfig {
    providers?: Record<string, BridgeProviderProfile>;
}
