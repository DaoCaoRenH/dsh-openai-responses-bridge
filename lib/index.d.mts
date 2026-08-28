import { RetryPolicyConfig } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/types.d.ts
/** JSON values accepted by a Responses payload or persisted hosted-tool setting. */
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}
/** Raw Responses tool definition. Unknown fields are preserved after validation. */
interface OpenAIResponsesTool {
  type: string;
  [key: string]: unknown;
}
/** Responses `tool_choice` values supported by the settings schema. */
type ResponsesToolChoice = 'none' | 'auto' | 'required' | JsonObject;
/** Hosted tool support mode for one route. */
type HostedSourcePresentation = 'auto' | 'inline-only' | 'append';
/** Hosted tool settings owned by one bridge provider route. */
interface HostedToolsConfig {
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
declare const DEFAULT_REASONING_EFFORTS: {
  readonly off: null;
  readonly low: "low";
  readonly medium: "medium";
  readonly high: "high";
  readonly xhigh: "xhigh";
  readonly max: "max";
};
/** Wire protocols owned by the Bridge settings namespace. */
declare const BRIDGE_API_PROTOCOLS: readonly ["openai-responses", "google-generative-ai"];
type BridgeApiProtocol = (typeof BRIDGE_API_PROTOCOLS)[number];
declare const DEFAULT_BRIDGE_API: BridgeApiProtocol;
/** One model declared by a third-party Responses route. */
interface BridgeModelProfile {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: Array<'text' | 'image'>;
  /** `false` disables reasoning; an object maps DSH levels to wire values. */
  reasoningEfforts?: false | Partial<Record<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', string | null>>;
}
/** One provider route in the bridge settings namespace. */
interface BridgeProviderProfile {
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
interface BridgeConfig {
  providers?: Record<string, BridgeProviderProfile>;
}
//#endregion
//#region src/config.d.ts
/** Runtime schema consumed by the DSH settings service. */
declare const Config: z<BridgeConfig>;
/** Validate cross-field settings that a schema cannot express. */
declare function assertServiceable(config: BridgeConfig): void;
//#endregion
//#region src/compatibility.d.ts
/**
 * Apply only the Bridge delta to a native pi-ai Responses payload.
 *
 * The payload has already been built by `openAIResponsesApi()`: message
 * conversion, reasoning replay, tool conversion, usage, and SSE processing all
 * remain in pi-ai. This function deliberately owns only the two Bridge
 * differences: third-party gateways reject `max_output_tokens`, and an opted-in
 * route may add the Responses hosted `web_search` tool.
 */
declare function applyBridgeRequest(payload: unknown, hosted?: HostedToolsConfig): unknown;
//#endregion
//#region src/index.d.ts
/** Cordis plugin identity; the bundle patch mounts this row by package name. */
declare const name = "llm-openai-responses-bridge";
/** The bridge needs the DSH LLM registry; settings and credentials are optional seams. */
declare const inject: string[];
/** Install the route registry, settings namespace, and credential resolution hooks. */
declare function apply(ctx: Context, config: BridgeConfig): void;
declare const _default: {
  name: string;
  inject: string[];
  Config: import("@deepseek-ai/schemastery").default<BridgeConfig>;
  apply: typeof apply;
};
//#endregion
export { type BRIDGE_API_PROTOCOLS, type BridgeApiProtocol, type BridgeConfig, type BridgeModelProfile, type BridgeProviderProfile, Config, type DEFAULT_BRIDGE_API, type DEFAULT_REASONING_EFFORTS, type HostedSourcePresentation, type HostedToolsConfig, type JsonObject, type JsonPrimitive, type JsonValue, type OpenAIResponsesTool, type ResponsesToolChoice, apply, applyBridgeRequest, assertServiceable, _default as default, inject, name };