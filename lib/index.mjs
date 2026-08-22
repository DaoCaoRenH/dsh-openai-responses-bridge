import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { INVALID_CREDENTIAL_CODE, LlmError, RetryPolicySchema, assertUsableApiKey, attributionHeaders, normalizeApiKey, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import OpenAI from "openai";
import { clampThinkingLevel, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { clampOpenAIPromptCacheKey } from "@earendil-works/pi-ai/api/openai-prompt-cache";
import { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
//#region src/types.ts
/** Default reasoning dispatch map for Bridge-declared models. */
const DEFAULT_REASONING_EFFORTS = {
	off: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max"
};
/** Wire protocols owned by the Bridge settings namespace. */
const BRIDGE_API_PROTOCOLS = ["openai-responses", "google-generative-ai"];
const DEFAULT_BRIDGE_API = "openai-responses";
//#endregion
//#region src/config.ts
const modelSchema = z.object({
	id: z.string().required(),
	name: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	input: z.array(z.union(["text", "image"])).default(["text"]),
	reasoningEfforts: z.union([z.const(false), z.dict(z.union([z.string(), z.const(null)]), z.union([
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	]))]).default(DEFAULT_REASONING_EFFORTS)
});
const rawToolSchema = z.any();
const toolChoiceSchema = z.any();
const hostedToolsSchema = z.object({
	enabled: z.boolean().default(false),
	definitions: z.array(rawToolSchema).default([{ type: "web_search" }]),
	toolChoice: toolChoiceSchema,
	include: z.array(z.string()).default([]),
	sourcePresentation: z.union([
		"auto",
		"inline-only",
		"append"
	]).default("auto"),
	imageGeneration: z.object({
		enabled: z.boolean().default(false),
		outputBackend: z.const("dsh-attachment"),
		maxBytes: z.number().step(1).min(1)
	})
});
const providerSchema = z.object({
	api: z.union(BRIDGE_API_PROTOCOLS).default(DEFAULT_BRIDGE_API),
	apiKeyEnv: z.string().required(),
	displayName: z.string(),
	baseURL: z.string().required(),
	models: z.array(modelSchema).default([]),
	reasoning: z.union([
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	]),
	headers: z.dict(z.string()),
	streamIdleTimeoutMs: z.number().step(1).min(1).default(3e5),
	retryPolicy: RetryPolicySchema,
	hostedTools: hostedToolsSchema
});
/** Runtime schema consumed by the DSH settings service. */
const Config = z.object({ providers: z.dict(providerSchema).default({}) });
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
const EXECUTOR_DEPENDENT_TYPES = /* @__PURE__ */ new Set([
	"computer",
	"computer_use_preview",
	"local_shell",
	"shell",
	"apply_patch",
	"custom"
]);
const HOSTED_CALL_TYPES = /* @__PURE__ */ new Set([
	"file_search",
	"web_search",
	"web_search_preview",
	"code_interpreter",
	"image_generation",
	"mcp",
	"tool_search",
	"namespace",
	"function"
]);
function validateTool(route, tool) {
	if (!isRecord$1(tool) || typeof tool.type !== "string" || tool.type.trim().length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" has a hosted tool without a non-empty type`);
	if (EXECUTOR_DEPENDENT_TYPES.has(tool.type)) throw new Error(`llm-openai-responses-bridge: hosted tool type "${tool.type}" is disabled until DSH provides an executor and approval continuation`);
	if (!HOSTED_CALL_TYPES.has(tool.type)) throw new Error(`llm-openai-responses-bridge: hosted tool type "${tool.type}" is not enabled in V1`);
	if (tool.type === "file_search") {
		const stores = tool.vector_store_ids;
		if (!Array.isArray(stores) || stores.length === 0 || stores.some((item) => typeof item !== "string" || item.length === 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" file_search requires non-empty vector_store_ids`);
	}
	if (tool.type === "mcp") {
		for (const key of [
			"authorization",
			"api_key",
			"token",
			"secret"
		]) if (key in tool) throw new Error(`llm-openai-responses-bridge: provider "${route}" must keep MCP credential "${key}" in DSH credentials, not settings`);
	}
}
function validateToolChoice(route, value) {
	if (value === void 0 || typeof value === "string") return;
	if (!isRecord$1(value) || typeof value.type !== "string") throw new Error(`llm-openai-responses-bridge: provider "${route}" toolChoice object must have a type`);
}
/** Validate cross-field settings that a schema cannot express. */
function assertServiceable(config) {
	for (const [route, source] of Object.entries(config.providers ?? {})) {
		if (route.trim().length === 0 || /\s/u.test(route)) throw new Error(`llm-openai-responses-bridge: invalid provider route "${route}"`);
		const api = source.api ?? "openai-responses";
		if (!BRIDGE_API_PROTOCOLS.includes(api)) throw new Error(`llm-openai-responses-bridge: provider "${route}" names unsupported api "${String(source.api)}"`);
		if (typeof source.apiKeyEnv !== "string" || source.apiKeyEnv.trim().length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" requires apiKeyEnv`);
		if (typeof source.baseURL !== "string" || source.baseURL.trim().length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" requires baseURL`);
		let url;
		try {
			url = new URL(source.baseURL);
		} catch {
			throw new Error(`llm-openai-responses-bridge: provider "${route}" baseURL must be an absolute HTTP(S) URL`);
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`llm-openai-responses-bridge: provider "${route}" baseURL must use http or https`);
		const models = source.models ?? [];
		if (models.length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" must declare at least one model`);
		const ids = /* @__PURE__ */ new Set();
		for (const model of models) {
			if (model.id.trim().length === 0 || ids.has(model.id)) throw new Error(`llm-openai-responses-bridge: provider "${route}" has a duplicate or empty model id`);
			ids.add(model.id);
			if ((model.input ?? ["text"]).length === 0) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" must accept text or image`);
			if (model.contextWindow !== void 0 && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" has invalid contextWindow`);
			if (model.maxTokens !== void 0 && (!Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" model "${model.id}" has invalid maxTokens`);
		}
		const hosted = source.hostedTools;
		if (api === "google-generative-ai" && hosted?.enabled === true) throw new Error(`llm-openai-responses-bridge: hostedTools is only supported for the openai-responses protocol; provider "${route}" uses google-generative-ai`);
		const definitions = hosted?.enabled === true ? hosted.definitions ?? [{ type: "web_search" }] : [];
		for (const tool of definitions) validateTool(route, tool);
		validateToolChoice(route, hosted?.toolChoice);
		if (definitions.some((tool) => tool.type === "image_generation") && hosted?.imageGeneration?.enabled !== true) throw new Error(`llm-openai-responses-bridge: provider "${route}" must explicitly enable imageGeneration for image_generation`);
		if (hosted?.imageGeneration?.enabled === true) throw new Error(`llm-openai-responses-bridge: provider "${route}" imageGeneration requires a verified DSH assistant-image output backend; none is available in rc.2`);
		if (hosted?.imageGeneration?.maxBytes !== void 0 && (!Number.isSafeInteger(hosted.imageGeneration.maxBytes) || hosted.imageGeneration.maxBytes <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" imageGeneration.maxBytes must be a positive safe integer`);
		if (source.streamIdleTimeoutMs !== void 0 && (!Number.isSafeInteger(source.streamIdleTimeoutMs) || source.streamIdleTimeoutMs <= 0)) throw new Error(`llm-openai-responses-bridge: provider "${route}" streamIdleTimeoutMs must be a positive safe integer`);
	}
}
//#endregion
//#region src/discovery.ts
/**
* Model discovery for the Bridge settings card.
*
* The browser sends the endpoint and one-shot key for the draft that is still
* being edited. Nothing is stored here; the returned rows are only candidates
* for the client-side model picker. The route configuration is written later
* through settings.mutate.
*/
const BRIDGE_DISCOVERY_API = "openai-responses-bridge";
const GOOGLE_DISCOVERY_API = "google-generative-ai";
const MAX_RESPONSE_BYTES = 4194304;
function recordOf$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function positiveInteger(...values) {
	for (const value of values) if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
}
function nonEmptyString(...values) {
	for (const value of values) if (typeof value === "string" && value.trim().length > 0) return value.trim();
}
function listingUrl(baseURL) {
	return `${baseURL.replace(/\/+$/u, "")}/models`;
}
async function readBounded(response, url) {
	const oversized = () => new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, "DISCOVERY_FAILED");
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		await response.body?.cancel();
		throw oversized();
	}
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) throw oversized();
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => void 0);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}
function readListing(body) {
	const record = recordOf$1(body);
	const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : void 0;
	if (rawModels === void 0) throw new LlmError("the endpoint model listing has no \"data\" or \"models\" array; enter the models by hand", "DISCOVERY_FAILED");
	const models = [];
	for (const raw of rawModels) {
		const entry = recordOf$1(raw);
		const id = nonEmptyString(entry.id);
		if (id === void 0) continue;
		const name = nonEmptyString(entry.name, entry.display_name);
		const contextWindow = positiveInteger(entry.context_window, entry.context_length);
		const maxTokens = positiveInteger(entry.max_output_tokens, entry.max_tokens);
		models.push({
			id,
			...name === void 0 ? {} : { name },
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens }
		});
	}
	return models;
}
function usableProbeKey(raw) {
	const checked = normalizeApiKey(raw);
	if (checked.ok) return checked.value;
	throw new LlmError(checked.reason === "empty" ? "the Bridge discovery API key is blank; enter a key or leave discovery unauthenticated" : "the Bridge discovery API key contains characters no HTTP header can carry; paste the raw key only", INVALID_CREDENTIAL_CODE);
}
/**
* Ask one OpenAI-compatible third-party endpoint for its model directory.
* The Bridge protocol is intentionally the only accepted wire face here; it
* is not added to DSH's native pi-ai protocol union.
*/
async function discoverModels(request, storedApiKey) {
	if (request.baseURL === void 0 || request.baseURL.trim().length === 0) throw new LlmError("Bridge model discovery needs a non-empty baseURL", "INVALID_DISCOVERY");
	if (request.api !== void 0 && request.api !== BRIDGE_DISCOVERY_API) throw new LlmError(request.api === GOOGLE_DISCOVERY_API ? "Google Generative AI model discovery is not supported by the Bridge /models probe; enter models manually" : `Bridge model discovery does not support protocol "${request.api}"`, "DISCOVERY_UNSUPPORTED");
	const url = listingUrl(request.baseURL.trim());
	const supplied = request.apiKey ?? await storedApiKey?.();
	const apiKey = supplied === void 0 ? void 0 : usableProbeKey(supplied);
	let response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				...apiKey === void 0 ? {} : { authorization: `Bearer ${apiKey}` },
				...attributionHeaders()
			},
			...request.signal === void 0 ? {} : { signal: request.signal }
		});
	} catch (error) {
		if (request.signal?.aborted) throw new LlmError("Bridge model discovery was aborted", "ABORTED", { cause: error });
		throw new LlmError(`could not reach ${url}`, "DISCOVERY_FAILED", { cause: error });
	}
	if (!response.ok) throw new LlmError(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? "; check the API key" : ""}`, "DISCOVERY_FAILED", { status: response.status });
	let text;
	try {
		text = await readBounded(response, url);
	} catch (error) {
		if (request.signal?.aborted) throw new LlmError("Bridge model discovery was aborted", "ABORTED", { cause: error });
		throw error;
	}
	let body;
	try {
		body = JSON.parse(text);
	} catch (error) {
		throw new LlmError(`${url} did not answer with JSON`, "DISCOVERY_FAILED", { cause: error });
	}
	return readListing(body);
}
//#endregion
//#region src/hosted-web-search/session.ts
const HOSTED_WEB_SEARCH_EVENT_TYPES = [
	"bridge/hosted-web-search/start",
	"bridge/hosted-web-search/update",
	"bridge/hosted-web-search/end"
];
/**
* Register the Bridge event family with the current DSH persistence catalog.
*
* DSH rc.2 exposes the catalog as a runtime Set but does not yet expose a
* public third-party event registration method. Mutating this exported Set is
* the narrow compatibility seam: the DSH session implementation and all
* persistence backends remain untouched, while a Bridge-loaded runtime knows
* that these log-only facts are safe to preserve. The Bridge Host must be
* loaded before persisted sessions are resumed.
*/
function registerHostedWebSearchSessionEvents() {
	const catalog = KNOWN_SESSION_EVENT_TYPES;
	for (const type of HOSTED_WEB_SEARCH_EVENT_TYPES) catalog.add(type);
}
/** Return the live session associated with the current Agent initiator, if any. */
function currentInitiatorSession(ctx) {
	try {
		return ctx.get("agents")?.currentInitiator()?.session;
	} catch {
		return;
	}
}
/**
* Locate the currently open DSH step. Hosted events are written from inside a
* provider stream, after `step/start` and before `step/end`; scanning the
* durable boundaries keeps turn/step placement deterministic on replay.
*/
function activeTurnStep(session) {
	let turn = 0;
	let step = 0;
	let stepOpen = false;
	for (const event of session.events) if (event.type === "turn/start") {
		turn = event.data.turn;
		step = 0;
		stepOpen = false;
	} else if (event.type === "turn/end") {
		if (event.data.turn === turn) stepOpen = false;
	} else if (event.type === "step/start") {
		turn = event.data.turn;
		step = event.data.step;
		stepOpen = true;
	} else if (event.type === "step/end" && event.data.turn === turn && event.data.step === step) stepOpen = false;
	return {
		turn,
		step: stepOpen ? step : 0
	};
}
/** Append one Bridge checkpoint without letting an auxiliary failure abort Pi. */
function appendHostedWebSearchCheckpoint(session, type, data) {
	if (session === void 0) return false;
	try {
		session.append.call(session, type, data);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/compatibility.ts
/** True for a JSON object that can be copied without changing its prototype. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Clone ordinary JSON-compatible data without retaining provider-owned references. */
function cloneJson(value) {
	if (Array.isArray(value)) return value.map(cloneJson);
	if (!isRecord(value)) return value;
	const result = {};
	for (const [key, item] of Object.entries(value)) result[key] = cloneJson(item);
	return result;
}
function toolType(value) {
	return isRecord(value) && typeof value.type === "string" ? value.type : void 0;
}
function stableKey(value) {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
function hostedDefinitions(hosted) {
	return hosted.definitions === void 0 ? [{ type: "web_search" }] : hosted.definitions.map((definition) => cloneJson(definition));
}
/** Whether this route has an enabled hosted web-search definition. */
function hostedWebSearchEnabled(hosted) {
	if (hosted?.enabled !== true) return false;
	return hostedDefinitions(hosted).some((definition) => {
		const type = toolType(definition);
		return type === "web_search" || type === "web_search_preview";
	});
}
function isLocalWebSearchFunction(value) {
	if (!isRecord(value)) return false;
	const type = typeof value.type === "string" ? value.type : void 0;
	return (type === "function" || type === "custom") && value.name === "web_search";
}
/**
* Apply only the Bridge delta to a native pi-ai Responses payload.
*
* The payload has already been built by `openAIResponsesApi()`: message
* conversion, reasoning replay, tool conversion, usage, and SSE processing all
* remain in pi-ai. This function deliberately owns only the two Bridge
* differences: third-party gateways reject `max_output_tokens`, and an opted-in
* route may add the Responses hosted `web_search` tool.
*/
function applyBridgeRequest(payload, hosted) {
	if (!isRecord(payload)) return payload;
	const result = cloneJson(payload);
	delete result.max_output_tokens;
	if (hosted?.enabled !== true) return result;
	const definitions = hostedDefinitions(hosted);
	const hasWebSearch = definitions.some((definition) => {
		const type = toolType(definition);
		return type === "web_search" || type === "web_search_preview";
	});
	const existingTools = Array.isArray(result.tools) ? result.tools : [];
	const tools = [];
	const seen = /* @__PURE__ */ new Set();
	for (const tool of [...existingTools, ...definitions]) {
		if (hasWebSearch && isLocalWebSearchFunction(tool)) continue;
		const key = stableKey(tool);
		if (seen.has(key)) continue;
		seen.add(key);
		tools.push(tool);
	}
	result.tools = tools;
	if (hosted.toolChoice !== void 0) result.tool_choice = cloneJson(hosted.toolChoice);
	else if (hasWebSearch && result.tool_choice === void 0) result.tool_choice = "auto";
	const include = [
		...Array.isArray(result.include) ? result.include : [],
		...hosted.include ?? [],
		...hasWebSearch ? ["web_search_call.action.sources"] : []
	];
	if (include.length > 0) result.include = [...new Set(include)];
	return result;
}
//#endregion
//#region src/hosted-web-search/normalize.ts
const MAX_QUERY_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 512;
const MAX_SNIPPET_LENGTH = 2e3;
const MAX_PUBLISHER_LENGTH = 256;
const MAX_PUBLISHED_AT_LENGTH = 128;
const MAX_SOURCES = 100;
const MAX_CITATIONS = 100;
function recordOf(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringOf(value, maxLength) {
	if (typeof value !== "string") return void 0;
	const valueTrimmed = value.trim();
	return valueTrimmed.length === 0 ? void 0 : valueTrimmed.slice(0, maxLength);
}
function integerOf(value) {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : void 0;
}
function httpUrlOf(value) {
	const url = stringOf(value, MAX_URL_LENGTH);
	if (url === void 0) return void 0;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : void 0;
	} catch {
		return;
	}
}
function statusOf(value) {
	if (value === "in_progress" || value === "searching" || value === "completed" || value === "failed" || value === "aborted") return value;
	if (value === "cancelled" || value === "canceled") return "aborted";
}
function statusFromEventType(type) {
	return statusOf(type.split(".").at(-1));
}
function idOf(...values) {
	for (const value of values) {
		const result = stringOf(value, 256);
		if (result !== void 0) return result;
	}
}
function queryValues(...values) {
	const result = [];
	const add = (value) => {
		if (Array.isArray(value)) {
			for (const item of value) add(item);
			return;
		}
		const query = stringOf(value, MAX_QUERY_LENGTH);
		if (query !== void 0 && !result.includes(query)) result.push(query);
	};
	for (const value of values) add(value);
	return result;
}
function sourceOf(value) {
	const source = recordOf(value);
	if (source === void 0) return void 0;
	const url = httpUrlOf(source.url ?? source.link ?? source.href ?? source.source_url);
	if (url === void 0) return void 0;
	const id = idOf(source.id, source.source_id);
	const title = stringOf(source.title ?? source.name ?? source.display_name, MAX_TITLE_LENGTH);
	const snippet = stringOf(source.snippet ?? source.description ?? source.excerpt ?? source.text, MAX_SNIPPET_LENGTH);
	const publisher = stringOf(source.publisher ?? source.site_name ?? source.domain, MAX_PUBLISHER_LENGTH);
	const publishedAt = stringOf(source.publishedAt ?? source.published_at ?? source.page_age, MAX_PUBLISHED_AT_LENGTH);
	return {
		...id === void 0 ? {} : { id },
		url,
		...title === void 0 ? {} : { title },
		...snippet === void 0 ? {} : { snippet },
		...publisher === void 0 ? {} : { publisher },
		...publishedAt === void 0 ? {} : { publishedAt }
	};
}
function sourceValues(...values) {
	const result = [];
	const byUrl = /* @__PURE__ */ new Map();
	const add = (value) => {
		if (Array.isArray(value)) {
			for (const item of value) add(item);
			return;
		}
		const source = sourceOf(value);
		if (source === void 0 || result.length >= MAX_SOURCES) return;
		const existingIndex = byUrl.get(source.url);
		if (existingIndex === void 0) {
			byUrl.set(source.url, result.length);
			result.push(source);
			return;
		}
		const existing = result[existingIndex];
		if (existing === void 0) return;
		result[existingIndex] = {
			...existing,
			...source.title === void 0 || existing.title !== void 0 ? {} : { title: source.title },
			...source.snippet === void 0 || existing.snippet !== void 0 ? {} : { snippet: source.snippet },
			...source.publisher === void 0 || existing.publisher !== void 0 ? {} : { publisher: source.publisher },
			...source.publishedAt === void 0 || existing.publishedAt !== void 0 ? {} : { publishedAt: source.publishedAt }
		};
	};
	for (const value of values) add(value);
	return result;
}
function citationOf(value) {
	const annotation = recordOf(value);
	if (annotation === void 0 || annotation.type !== "url_citation") return void 0;
	const url = httpUrlOf(annotation.url);
	if (url === void 0) return void 0;
	const title = stringOf(annotation.title, MAX_TITLE_LENGTH);
	const quotedText = stringOf(annotation.quoted_text ?? annotation.quotedText ?? annotation.cited_text, MAX_SNIPPET_LENGTH);
	const startIndex = integerOf(annotation.start_index ?? annotation.startIndex);
	const endIndex = integerOf(annotation.end_index ?? annotation.endIndex);
	return {
		url,
		...title === void 0 ? {} : { title },
		...startIndex === void 0 ? {} : { startIndex },
		...endIndex === void 0 ? {} : { endIndex },
		...quotedText === void 0 ? {} : { quotedText }
	};
}
function citationValues(value) {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	const add = (item) => {
		if (Array.isArray(item)) {
			for (const child of item) add(child);
			return;
		}
		const citation = citationOf(item);
		if (citation === void 0) return;
		const key = JSON.stringify(citation);
		if (seen.has(key) || result.length >= MAX_CITATIONS) return;
		seen.add(key);
		result.push(citation);
	};
	add(value);
	return result;
}
function annotationsOf(value) {
	const item = recordOf(value);
	if (item === void 0) return [];
	const content = Array.isArray(item.content) ? item.content : [];
	const result = [];
	for (const contentItem of content) {
		const contentRecord = recordOf(contentItem);
		if (contentRecord !== void 0) result.push(...citationValues(contentRecord.annotations));
	}
	return result;
}
function fingerprint(state) {
	return JSON.stringify(state);
}
/**
* Observe raw OpenAI Responses events without taking ownership of Pi's parser.
* Unknown provider fields/events are ignored; all durable output is bounded,
* URL-validated, and free of request headers or payloads.
*/
var HostedWebSearchObserver = class {
	options;
	entries = /* @__PURE__ */ new Map();
	outputIndex = /* @__PURE__ */ new Map();
	itemIds = /* @__PURE__ */ new Map();
	responseId;
	sequence = 0;
	responseTerminal = false;
	pendingCitations = [];
	constructor(options) {
		this.options = options;
		this.responseId = options.responseId;
	}
	/** Consume one raw Responses event. This method never throws for malformed provider data. */
	observe(raw) {
		try {
			this.observeUnsafe(raw);
		} catch {}
	}
	/** Finalize on normal parser completion or an abnormal stream close. */
	finish(reason = "failed", error) {
		if (!this.responseTerminal) {
			this.responseTerminal = true;
			for (const entry of this.entries.values()) if (!entry.ended) this.endEntry(entry, reason, error);
			return;
		}
		for (const entry of this.entries.values()) if (!entry.ended) this.endEntry(entry, reason, error);
	}
	observeUnsafe(raw) {
		const event = recordOf(raw);
		if (event === void 0) return;
		const type = typeof event.type === "string" ? event.type : "";
		this.sequence += 1;
		if (type === "response.created") {
			const response = recordOf(event.response);
			this.responseId = idOf(response?.id, event.response_id) ?? this.responseId;
			this.updateResponseId();
			return;
		}
		if (type === "response.output_item.added") {
			const item = recordOf(event.item);
			if (this.isSearchItem(item)) {
				const entry = this.entryFor(event, item);
				this.applyItem(entry, item, event);
			} else if (item !== void 0) this.applyAnnotations(this.entryForOutput(event.output_index), annotationsOf(item));
			return;
		}
		if (type === "response.output_item.done") {
			const item = recordOf(event.item);
			if (this.isSearchItem(item)) {
				const entry = this.entryFor(event, item);
				this.applyItem(entry, item, event);
			} else if (item !== void 0) this.applyAnnotations(this.entryForOutput(event.output_index), annotationsOf(item));
			return;
		}
		if (type === "response.output_text.annotation.added" || type === "response.output_text.annotation.delta") {
			const target = this.entryForOutput(event.output_index) ?? this.latestEntry();
			this.applyAnnotations(target, citationValues(event.annotation ?? event.annotations));
			return;
		}
		if (type.startsWith("response.web_search_call.")) {
			const entry = this.entryFor(event);
			this.applyItem(entry, recordOf(event.item) ?? event, event);
			return;
		}
		if (type === "response.completed" || type === "response.incomplete") {
			const response = recordOf(event.response);
			this.responseId = idOf(response?.id, event.response_id) ?? this.responseId;
			const output = Array.isArray(response?.output) ? response.output : [];
			for (const itemValue of output) {
				const item = recordOf(itemValue);
				if (this.isSearchItem(item)) {
					const entry = this.entryFor({}, item);
					this.applyItem(entry, item, response ?? {});
				} else if (item !== void 0) this.applyAnnotations(this.latestEntry(), annotationsOf(item));
			}
			this.responseTerminal = true;
			const incomplete = response?.status === "incomplete" || type === "response.incomplete";
			const failed = response?.status === "failed" || response?.status === "cancelled" || response?.status === "canceled";
			const responseStatus = incomplete || failed ? "failed" : "completed";
			const responseError = incomplete ? {
				message: "Responses stream ended with an incomplete response",
				code: "RESPONSE_INCOMPLETE"
			} : failed ? this.errorOf({}, response?.error) ?? {
				message: "Responses stream ended with a failed response",
				code: "RESPONSE_FAILED"
			} : void 0;
			for (const entry of this.entries.values()) if (!entry.ended) this.endEntry(entry, entry.state.status === "failed" ? "failed" : responseStatus, responseError);
			return;
		}
		if (type === "response.failed" || type === "error") {
			const error = this.errorOf(event, recordOf(event.response)?.error);
			this.responseTerminal = true;
			for (const entry of this.entries.values()) if (!entry.ended) this.endEntry(entry, "failed", error);
			return;
		}
	}
	isSearchItem(item) {
		return item?.type === "web_search_call" || item?.type === "web_search_preview";
	}
	entryFor(event, item) {
		const action = recordOf(item?.action) ?? recordOf(event.action);
		const eventType = typeof event.type === "string" ? event.type : "";
		const outputIndex = integerOf(event.output_index);
		const itemId = idOf(event.item_id, event.call_id, event.search_id, event.search_call_id, event.id, item?.id);
		const id = itemId ?? (outputIndex === void 0 ? void 0 : `bridge-search-${this.responseId ?? "response"}-${outputIndex}`) ?? `bridge-search-${this.responseId ?? "response"}-${this.sequence}`;
		const existing = this.entries.get(id);
		if (existing !== void 0) return existing;
		const initial = {
			version: 1,
			searchId: id,
			turn: this.options.turn,
			step: this.options.step,
			provider: this.options.provider,
			model: this.options.model,
			...this.responseId === void 0 ? {} : { responseId: this.responseId },
			status: statusOf(item?.status) ?? statusOf(event.status) ?? statusFromEventType(eventType) ?? "in_progress",
			queries: queryValues(action?.query, action?.queries, item?.query, event.query),
			sources: sourceValues(action?.sources, item?.sources, event.sources),
			citations: []
		};
		const entry = {
			id,
			...outputIndex === void 0 ? {} : { outputIndex },
			...itemId === void 0 ? {} : { itemId },
			state: initial,
			lastFingerprint: "",
			ended: false
		};
		this.entries.set(id, entry);
		if (outputIndex !== void 0) this.outputIndex.set(outputIndex, entry);
		if (itemId !== void 0) this.itemIds.set(itemId, entry);
		this.emit(entry, "start");
		if (this.pendingCitations.length > 0) {
			const pending = this.pendingCitations;
			this.pendingCitations = [];
			this.applyAnnotations(entry, pending);
		}
		return entry;
	}
	entryForOutput(value) {
		const outputIndex = integerOf(value);
		return outputIndex === void 0 ? void 0 : this.outputIndex.get(outputIndex);
	}
	latestEntry() {
		return [...this.entries.values()].at(-1);
	}
	applyItem(entry, item, event) {
		const action = recordOf(item.action) ?? recordOf(event.action);
		const nextStatus = statusOf(item.status) ?? statusOf(event.status) ?? statusFromEventType(typeof event.type === "string" ? event.type : "");
		const queries = queryValues(entry.state.queries, action?.query, action?.queries, item.query, event.query);
		const sources = sourceValues(entry.state.sources, action?.sources, item.sources, event.sources);
		const error = this.errorOf(event, item.error);
		const next = {
			...entry.state,
			...this.responseId === void 0 ? {} : { responseId: this.responseId },
			...nextStatus === void 0 ? {} : { status: nextStatus },
			queries,
			sources,
			...error === void 0 ? {} : { error }
		};
		this.replace(entry, next);
	}
	applyAnnotations(entry, citations) {
		if (citations.length === 0) return;
		if (entry === void 0) {
			const seen = new Set(this.pendingCitations.map((citation) => JSON.stringify(citation)));
			for (const citation of citations) {
				const key = JSON.stringify(citation);
				if (seen.has(key) || this.pendingCitations.length >= MAX_CITATIONS) continue;
				seen.add(key);
				this.pendingCitations.push(citation);
			}
			return;
		}
		const seen = new Set(entry.state.citations.map((citation) => JSON.stringify(citation)));
		const merged = [...entry.state.citations];
		for (const citation of citations) {
			const key = JSON.stringify(citation);
			if (seen.has(key) || merged.length >= MAX_CITATIONS) continue;
			seen.add(key);
			merged.push(citation);
		}
		this.replace(entry, {
			...entry.state,
			citations: merged
		});
	}
	updateResponseId() {
		if (this.responseId === void 0) return;
		for (const entry of this.entries.values()) if (entry.state.responseId !== this.responseId) this.replace(entry, {
			...entry.state,
			responseId: this.responseId
		});
	}
	replace(entry, state) {
		entry.state = state;
		if (!entry.ended) this.emit(entry, "update");
	}
	emit(entry, kind) {
		const nextFingerprint = fingerprint(entry.state);
		if (kind === "update" && nextFingerprint === entry.lastFingerprint) return;
		if (kind === "end") entry.ended = true;
		entry.lastFingerprint = nextFingerprint;
		this.options.onCheckpoint(kind, entry.state);
	}
	endEntry(entry, status, error) {
		if (entry.ended) return;
		entry.state = {
			...entry.state,
			status,
			...error === void 0 ? {} : { error }
		};
		this.emit(entry, "end");
	}
	errorOf(event, responseError) {
		const error = recordOf(event.error) ?? recordOf(responseError);
		if (error === void 0) return void 0;
		const message = stringOf(error.message ?? error.detail ?? event.message, MAX_SNIPPET_LENGTH) ?? "Hosted web search failed";
		const code = stringOf(error.code ?? error.type, 128);
		return {
			message,
			...code === void 0 ? {} : { code }
		};
	}
};
//#endregion
//#region src/hosted-web-search/stream.ts
const OPENAI_TOOL_CALL_PROVIDERS = /* @__PURE__ */ new Set([
	"openai",
	"openai-codex",
	"opencode"
]);
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
function hasHeader(headers, name) {
	if (headers === void 0) return false;
	const expected = name.toLowerCase();
	return Object.entries(headers).some(([key, value]) => key.toLowerCase() === expected && value !== null && value.trim().length > 0);
}
function apiKeyFor(model, options) {
	if (options?.apiKey !== void 0 && options.apiKey.length > 0) return options.apiKey;
	if (hasHeader(options?.headers, "authorization") || hasHeader(options?.headers, "cf-aig-authorization")) return "unused";
	throw new Error(`No API key for provider: ${model.provider}`);
}
function sessionAffinityFormat(model) {
	const compat = model.compat;
	if (compat?.sessionAffinityFormat !== void 0) return compat.sessionAffinityFormat;
	return model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai") ? "openrouter" : "openai";
}
function headersOf(response) {
	return Object.fromEntries(response.headers.entries());
}
function createClient(model, options, session) {
	const headers = { ...model.headers };
	const affinity = sessionAffinityFormat(model);
	if (session !== void 0) {
		if (affinity === "openrouter") headers["x-session-id"] = session;
		else if (affinity === "openai") {
			headers.session_id = session;
			headers["x-client-request-id"] = session;
		} else headers["x-client-request-id"] = session;
	}
	Object.assign(headers, options?.headers);
	return new OpenAI({
		apiKey: apiKeyFor(model, options),
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers
	});
}
function buildParams(model, context, options) {
	const compat = model.compat;
	const supportsStrictMode = compat?.supportsStrictMode ?? false;
	const supportsOpenAIGrammarTools = compat?.supportsOpenAIGrammarTools ?? false;
	const cacheRetention = resolveCacheRetention(options?.cacheRetention, options?.env);
	const supportsLongCacheRetention = compat?.supportsLongCacheRetention ?? true;
	const supportsExplicitPromptCacheMode = compat?.supportsExplicitPromptCacheMode ?? false;
	const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, supportsOpenAIGrammarTools);
	const params = {
		model: model.id,
		input: convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS, {
			grammarToolInputProperties,
			toolOptions: {
				supportsStrictMode,
				supportsOpenAIGrammarTools
			}
		}),
		stream: true,
		prompt_cache_key: cacheRetention === "none" ? void 0 : clampOpenAIPromptCacheKey(options?.sessionId),
		prompt_cache_retention: cacheRetention === "long" && supportsLongCacheRetention ? "24h" : void 0,
		prompt_cache_options: cacheRetention === "none" && supportsExplicitPromptCacheMode ? { mode: "explicit" } : void 0,
		store: false
	};
	if (options?.sessionId !== void 0 && options.cacheRetention !== "none") params.prompt_cache_key = options.sessionId;
	if (options?.maxTokens !== void 0 && options.maxTokens > 0) params.max_output_tokens = Math.max(options.maxTokens, OPENAI_RESPONSES_MIN_OUTPUT_TOKENS);
	if (options?.temperature !== void 0) params.temperature = options.temperature;
	if (options?.serviceTier !== void 0) params.service_tier = options.serviceTier;
	if ((context.tools?.length ?? 0) > 0) params.tools = convertResponsesTools(context.tools ?? [], {
		supportsStrictMode,
		supportsOpenAIGrammarTools
	});
	if (options?.toolChoice !== void 0) params.tool_choice = options.toolChoice;
	if (model.reasoning) {
		if (options?.reasoningEffort !== void 0 || options?.reasoningSummary !== void 0) {
			params.reasoning = {
				effort: options.reasoningEffort === void 0 ? "medium" : model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
				summary: options.reasoningSummary ?? "auto"
			};
			params.include = ["reasoning.encrypted_content"];
		} else if (model.provider !== "github-copilot" && model.thinkingLevelMap?.off !== null) params.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
	}
	return params;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function resolveCacheRetention(cacheRetention, env) {
	if (cacheRetention !== void 0) return cacheRetention;
	if (env?.PI_CACHE_RETENTION === "long" || process.env.PI_CACHE_RETENTION === "long") return "long";
	return "short";
}
async function* observedStream(source, observer, signal) {
	try {
		for await (const event of source) {
			observer.observe(event);
			yield event;
		}
		observer.finish("failed", {
			message: "Responses stream ended before a terminal event",
			code: "STREAM_INCOMPLETE"
		});
	} catch (error) {
		observer.finish(signal?.aborted === true ? "aborted" : "failed", {
			message: signal?.aborted === true ? "Hosted web search request aborted" : errorMessage(error),
			code: signal?.aborted === true ? "ABORTED" : "STREAM_ERROR"
		});
		throw error;
	}
}
/**
* Hosted-enabled Responses path. Only this path owns the HTTP stream: Pi's
* public converters and `processResponsesStream()` still own message,
* reasoning, usage, error, and replay semantics. Hosted-disabled routes never
* call this function and remain on `openAIResponsesApi()`.
*/
function hostedResponsesStream(model, context, options, config) {
	const stream = createAssistantMessageEventStream();
	const session = config.resolveSession();
	const location = session === void 0 ? {
		turn: 0,
		step: 0
	} : activeTurnStep(session);
	const observer = new HostedWebSearchObserver({
		provider: String(model.provider),
		model: model.id,
		...location,
		onCheckpoint: (kind, state) => {
			appendHostedWebSearchCheckpoint(session, `bridge/hosted-web-search/${kind}`, state);
		}
	});
	(async () => {
		const output = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0
				}
			},
			stopReason: "stop",
			timestamp: Date.now()
		};
		try {
			const client = createClient(model, options, options?.sessionId);
			const rawParams = buildParams(model, context, options);
			const params = await options?.onPayload?.(rawParams, model) ?? rawParams;
			const requestOptions = {
				...options?.signal === void 0 ? {} : { signal: options.signal },
				...options?.timeoutMs === void 0 ? {} : { timeout: options.timeoutMs },
				maxRetries: 0
			};
			const { data, response } = await client.responses.create(params, requestOptions).withResponse();
			await options?.onResponse?.({
				status: response.status,
				headers: headersOf(response)
			}, model);
			stream.push({
				type: "start",
				partial: output
			});
			const compat = model.compat;
			await processResponsesStream(observedStream(data, observer, options?.signal), output, stream, model, {
				grammarToolInputProperties: createGrammarToolInputProperties(context.tools, compat?.supportsOpenAIGrammarTools ?? false),
				...options?.serviceTier === void 0 ? {} : { serviceTier: options.serviceTier }
			});
			if (options?.signal?.aborted === true) throw new Error("Request was aborted");
			if (output.stopReason === "aborted" || output.stopReason === "error") throw new Error("An unknown error occurred");
			stream.push({
				type: "done",
				reason: output.stopReason,
				message: output
			});
			stream.end();
		} catch (error) {
			observer.finish(options?.signal?.aborted === true ? "aborted" : "failed", {
				message: options?.signal?.aborted === true ? "Request was aborted" : errorMessage(error),
				code: options?.signal?.aborted === true ? "ABORTED" : "RESPONSES_ERROR"
			});
			for (const block of output.content) {
				delete block.index;
				delete block.partialJson;
				delete block.customInput;
			}
			output.stopReason = options?.signal?.aborted === true ? "aborted" : "error";
			output.errorMessage = errorMessage(error);
			stream.push({
				type: "error",
				reason: output.stopReason,
				error: output
			});
			stream.end();
		}
	})();
	return stream;
}
/** Pi-compatible simple entry point for the hosted-enabled path. */
function hostedResponsesStreamSimple(model, context, options, config) {
	const base = buildBaseOptions(model, context, options, options?.apiKey);
	const clamped = options?.reasoning === void 0 ? void 0 : clampThinkingLevel(model, options.reasoning);
	return hostedResponsesStream(model, context, {
		...base,
		...clamped === void 0 || clamped === "off" ? {} : { reasoningEffort: clamped }
	}, config);
}
//#endregion
//#region src/profiles.ts
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20971520;
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4194304;
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1048576;
function apiKeyAuth(name) {
	return { apiKey: {
		name,
		resolve: ({ credential }) => Promise.resolve({
			auth: credential?.key === void 0 ? {} : { apiKey: credential.key },
			source: name
		})
	} };
}
function thinkingMap(model) {
	if (model.reasoningEfforts === void 0 || model.reasoningEfforts === false) return void 0;
	const map = { off: "none" };
	for (const [level, value] of Object.entries(model.reasoningEfforts)) {
		if (level === "off" && value === null) continue;
		map[level] = value ?? null;
	}
	return map;
}
function buildModel(route, baseURL, api, profile) {
	const input = [...profile.input ?? ["text"]];
	const reasoning = profile.reasoningEfforts !== void 0 && profile.reasoningEfforts !== false;
	const levelMap = thinkingMap(profile);
	return {
		id: profile.id,
		name: profile.name ?? profile.id,
		api,
		provider: route,
		baseUrl: baseURL,
		reasoning,
		...levelMap === void 0 ? {} : { thinkingLevelMap: levelMap },
		input,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		contextWindow: profile.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
		maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS
	};
}
function providerFor(route, source, api, models, hosted, resolveSession) {
	const native = api === "google-generative-ai" ? googleGenerativeAIApi() : openAIResponsesApi();
	const withBridgePayload = (options) => {
		const original = options?.onPayload;
		return {
			...options,
			onPayload: async (payload, model) => {
				return applyBridgeRequest(await original?.(payload, model) ?? payload, hosted);
			}
		};
	};
	const stream = (model, context, options) => api === "google-generative-ai" ? native.stream(model, context, options) : hostedWebSearchEnabled(hosted) ? hostedResponsesStream(model, context, withBridgePayload(options), {
		hostedTools: hosted,
		resolveSession
	}) : native.stream(model, context, withBridgePayload(options));
	const streamSimple = (model, context, options) => api === "google-generative-ai" ? native.streamSimple(model, context, options) : hostedWebSearchEnabled(hosted) ? hostedResponsesStreamSimple(model, context, withBridgePayload(options), {
		hostedTools: hosted,
		resolveSession
	}) : native.streamSimple(model, context, withBridgePayload(options));
	return {
		id: route,
		name: source.displayName ?? route,
		...source.baseURL === void 0 ? {} : { baseUrl: source.baseURL },
		auth: apiKeyAuth(source.displayName ?? route),
		getModels: () => models,
		stream,
		streamSimple
	};
}
/** Resolve settings into the profile objects expected by the public PiAiAdapter. */
function resolveProfiles(config, resolveSession = () => void 0) {
	const resolvedConfig = config ?? { providers: {} };
	assertServiceable(resolvedConfig);
	const result = /* @__PURE__ */ new Map();
	for (const [route, source] of Object.entries(resolvedConfig.providers ?? {})) {
		const api = source.api ?? "openai-responses";
		const modelProfiles = source.models ?? [];
		const models = modelProfiles.map((model) => buildModel(route, source.baseURL, api, model));
		const configuredMaxTokens = /* @__PURE__ */ new Map();
		for (const model of modelProfiles) if (model.maxTokens !== void 0) configuredMaxTokens.set(model.id, model.maxTokens);
		const retryPolicy = resolveRetryPolicy(source.retryPolicy, `llm-openai-responses-bridge: provider "${route}" retryPolicy`);
		const apiKeyEnv = credentialRef(source.apiKeyEnv);
		const profile = {
			provider: route,
			displayName: source.displayName ?? route,
			api,
			apiKeyEnv,
			...source.baseURL === void 0 ? {} : { baseURL: source.baseURL },
			...source.reasoning === void 0 ? {} : { reasoning: source.reasoning },
			...source.headers === void 0 ? {} : { headers: { ...source.headers } },
			streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
			maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
			requestImagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
			requestImageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
			retryPolicy,
			piProvider: providerFor(route, source, api, models, source.hostedTools, resolveSession),
			configuredMaxTokens
		};
		result.set(route, profile);
	}
	return result;
}
//#endregion
//#region src/pwshSandboxSchem.ts
const TARGET_TOOLS = /* @__PURE__ */ new Set([
	"pwsh",
	"bash",
	"edit",
	"write"
]);
const ESCALATION_PARAMS = /* @__PURE__ */ new Set(["sandbox_permissions", "justification"]);
function isObject(value) {
	return typeof value === "object" && value !== null;
}
/**
* Remove the two redundant escalation fields without mutating the original
* schema. The helper supports both DSH's compiled JSON Schema and the flat
* parameter-map shape used by a few compatible tool providers.
*/
function stripEscalationParams(parameters) {
	if (!isObject(parameters)) return parameters;
	const properties = parameters.properties;
	if (isObject(properties)) {
		let changed = false;
		const nextProperties = { ...properties };
		for (const key of ESCALATION_PARAMS) if (Object.hasOwn(nextProperties, key)) {
			delete nextProperties[key];
			changed = true;
		}
		if (!changed) return parameters;
		const required = parameters.required;
		const nextRequired = Array.isArray(required) ? required.filter((entry) => typeof entry !== "string" || !ESCALATION_PARAMS.has(entry)) : required;
		return {
			...parameters,
			properties: nextProperties,
			...nextRequired === void 0 ? {} : { required: nextRequired }
		};
	}
	let changed = false;
	const copy = { ...parameters };
	for (const key of ESCALATION_PARAMS) if (Object.hasOwn(copy, key)) {
		delete copy[key];
		changed = true;
	}
	return changed ? copy : parameters;
}
/**
* Install the sandbox schema compatibility behavior inside the Bridge bundle.
* It only changes what the model sees; execution authority and approval remain
* owned by DSH's native sandbox services.
*/
function applyPwshSandboxSchem(ctx) {
	ctx.on("system-prompt/assemble", async (_assembly, context, next) => {
		return next().then((assembled) => {
			const session = context.agent?.session;
			if (session === void 0) return assembled;
			const policy = ctx.get("sandboxPolicy");
			if (policy === void 0) return assembled;
			if (policy.resolve({ session }).mode !== "danger-full-access") return assembled;
			let changed = false;
			const tools = assembled.tools.map((tool) => {
				if (!TARGET_TOOLS.has(tool.name)) return tool;
				const parameters = stripEscalationParams(tool.parameters);
				if (parameters === tool.parameters) return tool;
				changed = true;
				return {
					...tool,
					parameters
				};
			});
			return changed ? {
				...assembled,
				tools
			} : assembled;
		});
	});
}
//#endregion
//#region src/index.ts
/** Cordis plugin identity; the bundle patch mounts this row by package name. */
const name = "llm-openai-responses-bridge";
/** The bridge needs the DSH LLM registry; settings and credentials are optional seams. */
const inject = ["llm"];
const NS = settingsNamespace("llm-openai-responses-bridge");
function registrationFacts(profiles) {
	return JSON.stringify([...profiles].map(([provider, profile]) => ({
		provider,
		displayName: profile.displayName,
		retryPolicy: profile.retryPolicy
	})));
}
/**
* Pi requires an auth store when it builds a model collection. Bridge routes
* authenticate through their explicit apiKeyEnv reference instead, so this
* store deliberately has no login persistence; authContext still exposes DSH
* credentials to provider-native ambient lookups such as Google ADC names.
*/
function bridgeAuth(ctx) {
	return {
		credentials: {
			read: async () => void 0,
			list: async () => [],
			modify: async (_provider, mutate) => mutate(void 0),
			delete: async () => void 0
		},
		authContext: {
			env: async (name) => {
				if (isCredentialRefName(name)) {
					const value = await ctx.get("credentials")?.resolve(credentialRef(name));
					if (value !== void 0) return value.value;
				}
				return launchEnvironmentOf(ctx).get(name)?.value;
			},
			fileExists: async () => false
		}
	};
}
/** Install the route registry, settings namespace, and credential resolution hooks. */
function apply(ctx, config) {
	registerHostedWebSearchSessionEvents();
	applyPwshSandboxSchem(ctx);
	let current = () => config;
	let lastRaw;
	let memoized;
	const profiles = () => {
		const raw = current();
		if (raw === lastRaw && memoized !== void 0) return memoized;
		const next = resolveProfiles(raw, () => currentInitiatorSession(ctx));
		lastRaw = raw;
		memoized = next;
		return next;
	};
	profiles();
	const resolveApiKey = async (provider, profile) => {
		const ref = profile.apiKeyEnv;
		if (ref === void 0) throw new LlmError(`llm-openai-responses-bridge: provider "${provider}" requires apiKeyEnv`, "MISSING_CREDENTIAL");
		const credentials = ctx.get("credentials");
		const value = credentials !== void 0 ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;
		if (value !== void 0 && value.trim().length > 0) return assertUsableApiKey(value, name, String(ref));
		throw new LlmError(`llm-openai-responses-bridge: no credential for provider route "${provider}"; set ${String(ref)} through DSH credentials or the launching environment`, "MISSING_CREDENTIAL");
	};
	ctx.llm.registerModelDiscovery(NS, (request) => discoverModels(request, request.provider === void 0 ? void 0 : async () => {
		const profile = profiles().get(request.provider);
		return profile === void 0 ? void 0 : resolveApiKey(request.provider, profile);
	}));
	const adapter = new PiAiAdapter({
		profiles,
		resolveApiKey,
		auth: bridgeAuth(ctx),
		resolveAttachments: () => ctx.get("attachments"),
		onReplayDegrade: (detail) => ctx.logger.warn(`llm-openai-responses-bridge: replay degraded for ${detail.provider}/${detail.model}: ${detail.reason}`)
	});
	let registration;
	let registeredFacts;
	const syncRegistrations = () => {
		const resolved = profiles();
		const routes = [...resolved.keys()];
		const nextFacts = registrationFacts(resolved);
		if (nextFacts !== registeredFacts) {
			if (registration === void 0) {
				if (routes.length > 0) registration = ctx.llm.registerAdapter(routes, adapter);
			} else registration.replace(routes);
			registeredFacts = nextFacts;
		}
	};
	syncRegistrations();
	installSettingsSection(ctx, NS, Config, config, {
		validate: assertServiceable,
		setSource: (source) => {
			current = source;
		},
		onChange: () => {
			try {
				syncRegistrations();
			} catch (error) {
				ctx.logger.error("llm-openai-responses-bridge: rejected route topology update; previous routes remain active");
				ctx.logger.error(error);
			}
		}
	});
}
var src_default = {
	name,
	inject,
	Config,
	apply
};
//#endregion
export { Config, apply, applyBridgeRequest, assertServiceable, src_default as default, inject, name };
