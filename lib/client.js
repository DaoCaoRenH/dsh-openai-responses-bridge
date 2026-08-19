window.__ModuleLoader__.load({
	id: "dsh-openai-responses-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperties(exports, {
			__esModule: { value: true },
			[Symbol.toStringTag]: { value: "Module" }
		});
		let _deepseek_ai_dsh_client_web_react = require("@deepseek-ai/dsh-client-web-react");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#region src/client/modelFields.ts
		const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/iu;
		const CAPACITY_SCALE = {
			k: 1e3,
			m: 1e6
		};
		/** Parse the same compact K/M capacity notation used by the native editor. */
		function parseCapacity(text) {
			const trimmed = text.trim();
			if (trimmed.length === 0) return void 0;
			const match = CAPACITY_PATTERN.exec(trimmed);
			if (match === null) return NaN;
			const suffix = match[2]?.toLowerCase();
			const scale = suffix === "k" || suffix === "m" ? CAPACITY_SCALE[suffix] : 1;
			const scaled = Number(match[1]) * scale;
			const rounded = Math.round(scaled);
			return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
		}
		/** Format a stored capacity without changing the underlying token count. */
		function formatCapacity(value) {
			if (!Number.isInteger(value) || value <= 0) return String(value);
			if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
			if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
			return String(value);
		}
		/** Validate the model rows before the Bridge settings schema sees them. */
		function validateBridgeModels(value) {
			const seen = /* @__PURE__ */ new Set();
			for (const [index, model] of value.entries()) {
				const id = typeof model.id === "string" ? model.id.trim() : "";
				if (id.length === 0) return {
					index,
					key: "modelIdRequired"
				};
				if (seen.has(id)) return {
					index,
					key: "modelIdDuplicate"
				};
				seen.add(id);
				if (model.name !== void 0 && (typeof model.name !== "string" || model.name.trim().length === 0)) return {
					index,
					key: "modelNameInvalid"
				};
				if (model.contextWindow !== void 0 && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)) return {
					index,
					key: "modelContextInvalid"
				};
				if (model.maxTokens !== void 0 && (!Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0)) return {
					index,
					key: "modelMaxTokensInvalid"
				};
				if (model.input !== void 0 && model.input.length === 0) return {
					index,
					key: "modelInputInvalid"
				};
			}
		}
		//#endregion
		//#region src/client/fields.ts
		/** The only settings namespace owned by the Bridge browser half. */
		const BRIDGE_SETTINGS_NS = "llm-openai-responses-bridge";
		/** A new draft starts with an empty model list, like DSH's native card. */
		function initialProviderDraft() {
			return {
				route: "",
				displayName: "",
				baseURL: "",
				api: DEFAULT_BRIDGE_API,
				apiKey: "",
				models: [],
				webSearch: false
			};
		}
		const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/u;
		function modelFailureMessage(key, index) {
			const prefix = `模型 ${index + 1}`;
			switch (key) {
				case "modelIdRequired": return `${prefix} 的 Model ID 不能为空。`;
				case "modelIdDuplicate": return `${prefix} 的 Model ID 与其他模型重复。`;
				case "modelNameInvalid": return `${prefix} 的显示名称必须是非空文本。`;
				case "modelContextInvalid": return `${prefix} 的 Context window 必须是正整数。`;
				case "modelMaxTokensInvalid": return `${prefix} 的 Max tokens 必须是正整数。`;
				case "modelInputInvalid": return `${prefix} 至少需要支持一种输入类型。`;
				default: return `${prefix} 的配置无效。`;
			}
		}
		/** Validate only facts the Bridge card owns before sending a Host mutation. */
		function validateProviderDraft(draft, existingRoutes = [], options = {}) {
			const route = draft.route.trim();
			if (!ROUTE_PATTERN.test(route)) return {
				field: "route",
				message: "Provider ID 需以小写字母开头，之后使用小写字母、数字或短横线。"
			};
			if ([...existingRoutes].includes(route)) return {
				field: "route",
				message: "已有提供方使用这个 Provider ID。"
			};
			if (!BRIDGE_API_PROTOCOLS.includes(draft.api)) return {
				field: "api",
				message: "API 协议不受当前 Bridge 支持。"
			};
			let url;
			try {
				url = new URL(draft.baseURL.trim());
			} catch {
				return {
					field: "baseURL",
					message: "API 地址必须是绝对 HTTP(S) URL。"
				};
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") return {
				field: "baseURL",
				message: "API 地址必须使用 http 或 https。"
			};
			if (options.requireApiKey !== false && draft.apiKey.trim().length === 0) return {
				field: "apiKey",
				message: "请输入 API 密钥。"
			};
			const modelFailure = validateBridgeModels(draft.models);
			if (modelFailure !== void 0) return {
				field: "models",
				index: modelFailure.index,
				message: modelFailureMessage(modelFailure.key, modelFailure.index)
			};
			if (draft.models.length === 0) return {
				field: "models",
				message: "至少需要添加一个模型。"
			};
		}
		function modelProfileFromDraft(model) {
			return {
				id: model.id.trim(),
				...model.name === void 0 || model.name.trim().length === 0 ? {} : { name: model.name.trim() },
				input: model.input === void 0 || model.input.length === 0 ? ["text"] : [...model.input],
				...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
				...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
				reasoningEfforts: model.reasoningEfforts === void 0 ? { ...DEFAULT_REASONING_EFFORTS } : model.reasoningEfforts
			};
		}
		/** Derive the private DSH credential reference used for a newly created route. */
		function deriveApiKeyRef(route) {
			return `DSH_BRIDGE_${route.trim().toUpperCase().replace(/[^A-Z0-9]+/gu, "_").replace(/^_+|_+$/gu, "") || "PROVIDER"}_API_KEY`;
		}
		/** Build the new route without including the write-only API key value. */
		function providerProfileFromDraft(draft) {
			return {
				api: draft.api,
				apiKeyEnv: deriveApiKeyRef(draft.route),
				displayName: draft.displayName.trim() || draft.route.trim(),
				baseURL: draft.baseURL.trim(),
				models: draft.models.map(modelProfileFromDraft),
				hostedTools: hostedToolsFromToggle(draft.api === "openai-responses" && draft.webSearch)
			};
		}
		/**
		* Rehydrate only the fields owned by the Bridge editor. Credentials remain
		* write-only, so an edit draft deliberately starts with an empty API-key box.
		*/
		function providerDraftFromProfile(route, profile) {
			const api = profile.api ?? "openai-responses";
			return {
				route,
				displayName: profile.displayName ?? route,
				baseURL: profile.baseURL ?? "",
				api,
				apiKey: "",
				models: (profile.models ?? []).map((model) => ({
					...model,
					...model.input === void 0 ? {} : { input: [...model.input] },
					...model.reasoningEfforts === void 0 ? { reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS } } : { reasoningEfforts: model.reasoningEfforts === false ? false : { ...model.reasoningEfforts } }
				})),
				webSearch: api === "openai-responses" && profile.hostedTools?.enabled === true
			};
		}
		/**
		* Build an edit patch without replacing the whole provider object. This keeps
		* settings owned by other Bridge surfaces (headers, retry policy, hosted tool
		* definitions, and so on) intact.
		*/
		function providerEditOps(route, profile, draft) {
			const base = ["providers", route];
			const ops = [
				{
					op: "set",
					path: [...base, "displayName"],
					value: draft.displayName.trim() || route
				},
				{
					op: "set",
					path: [...base, "baseURL"],
					value: draft.baseURL.trim()
				},
				{
					op: "set",
					path: [...base, "api"],
					value: draft.api
				},
				{
					op: "set",
					path: [...base, "models"],
					value: draft.models.map(modelProfileFromDraft)
				}
			];
			if (draft.apiKey.trim().length > 0 && profile.apiKeyEnv === void 0) ops.push({
				op: "set",
				path: [...base, "apiKeyEnv"],
				value: deriveApiKeyRef(route)
			});
			ops.push(...webSearchOps(route, profile, draft.webSearch, draft.api));
			return ops;
		}
		/** Remove one Bridge route without rebuilding the rest of the namespace. */
		function providerDeleteOps(route) {
			return [{
				op: "unset",
				path: ["providers", route]
			}];
		}
		/** The exact hosted-tools object used when a new route is created. */
		function hostedToolsFromToggle(enabled) {
			if (!enabled) return { enabled: false };
			return {
				enabled: true,
				definitions: [{ type: "web_search" }],
				toolChoice: "auto"
			};
		}
		function objectOf(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function stringOf(value) {
			return typeof value === "string" && value.length > 0 ? value : void 0;
		}
		/** Read the reference without ever asking the browser for its value. */
		function credentialRefOf(profile) {
			return stringOf(profile?.apiKeyEnv);
		}
		/** Whether a route has opted into the remote Responses web search tool. */
		function webSearchEnabled(profile) {
			return profile?.api !== "google-generative-ai" && profile?.hostedTools?.enabled === true;
		}
		function hasWebSearch(definitions) {
			return Array.isArray(definitions) && definitions.some((tool) => {
				const type = objectOf(tool).type;
				return type === "web_search" || type === "web_search_preview";
			});
		}
		/** Build minimal path operations for a summary-card web_search toggle. */
		function webSearchOps(route, profile, enabled, api = profile.api ?? "openai-responses") {
			const base = [
				"providers",
				route,
				"hostedTools"
			];
			const effectiveEnabled = api === "openai-responses" && enabled;
			const ops = [{
				op: "set",
				path: [...base, "enabled"],
				value: effectiveEnabled
			}];
			if (!effectiveEnabled) return ops;
			const hosted = objectOf(profile.hostedTools);
			if (!hasWebSearch(hosted.definitions)) {
				const definitions = Array.isArray(hosted.definitions) ? [...hosted.definitions, { type: "web_search" }] : [{ type: "web_search" }];
				ops.push({
					op: "set",
					path: [...base, "definitions"],
					value: definitions
				});
			}
			if (hosted.toolChoice === void 0) ops.push({
				op: "set",
				path: [...base, "toolChoice"],
				value: "auto"
			});
			return ops;
		}
		/** Return only safe presentation fields used by the summary card. */
		function summaryOf(profile) {
			const model = Array.isArray(profile.models) ? profile.models[0] : void 0;
			return {
				baseURL: stringOf(profile.baseURL) ?? "",
				model: stringOf(objectOf(model).id) ?? "—"
			};
		}
		//#endregion
		//#region src/client/store.ts
		function messageOf$2(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function recordOf(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function routeEntries(namespace, providers) {
			const source = recordOf(recordOf(namespace.value).providers);
			const active = new Set(providers.filter((entry) => entry.active).map((entry) => entry.provider));
			const directory = new Map(providers.filter((entry) => entry.settingsNs === BRIDGE_SETTINGS_NS).map((entry) => [entry.provider, entry]));
			return Object.entries(source).flatMap(([route, raw]) => {
				if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
				const profile = raw;
				const entry = directory.get(route);
				return [{
					route,
					profile,
					credentialRef: credentialRefOf(profile),
					credential: void 0,
					active: active.has(route) || entry?.active === true,
					displayName: typeof profile.displayName === "string" && profile.displayName.length > 0 ? profile.displayName : route
				}];
			});
		}
		/** Settings/credentials/LLM join owned by this one page. */
		var BridgeSettingsStore = class {
			api;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				status: "idle",
				error: null,
				credentialError: null,
				writable: false,
				revision: 0,
				namespace: void 0,
				routes: []
			});
			generation = 0;
			constructor(api) {
				this.api = api;
			}
			async load() {
				const generation = ++this.generation;
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				try {
					const [settingsResponse, providersResponse] = await Promise.all([this.api.settings.describe({}), this.api.llm.providers({})]);
					if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message);
					const settingsValue = settingsResponse.result.value;
					const namespace = settingsValue.namespaces.find((view) => view.ns === BRIDGE_SETTINGS_NS);
					if (namespace === void 0) {
						if (generation !== this.generation) return;
						this.store.update((state) => {
							state.status = "missing";
							state.writable = settingsValue.writable;
							state.namespace = void 0;
							state.routes = [];
							state.revision = 0;
						});
						return;
					}
					const routes = routeEntries(namespace, providersResponse.result.ok ? providersResponse.result.value.providers : []);
					const refs = [...new Set(routes.flatMap((route) => route.credentialRef === void 0 ? [] : [route.credentialRef]))];
					let credentialError = null;
					let credentials = {};
					if (refs.length > 0) try {
						const credentialsResponse = await this.api.credentials.describe({ refs });
						if (credentialsResponse.result.ok) credentials = credentialsResponse.result.value.credentials;
						else credentialError = credentialsResponse.result.error.message;
					} catch (error) {
						credentialError = messageOf$2(error);
					}
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "ready";
						state.error = null;
						state.credentialError = credentialError;
						state.writable = settingsValue.writable;
						state.namespace = namespace;
						state.revision = namespace.revision;
						state.routes = routes.map((route) => ({
							...route,
							...route.credentialRef !== void 0 && credentials[route.credentialRef] !== void 0 ? { credential: credentials[route.credentialRef] } : {}
						}));
					});
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((state) => {
						state.status = "error";
						state.error = messageOf$2(error);
					});
				}
			}
			dispose() {
				this.generation += 1;
			}
		};
		/** Refresh only after a section has been opened once. */
		function refreshIfLoaded(controller) {
			const status = controller.store.getSnapshot().status;
			if (status === "idle" || status === "loading") return;
			controller.load();
		}
		//#endregion
		//#region \0dsh-bridge-css:llm-openai-responses-bridge/BridgeSection.module.css.mjs
		const css$1 = ".-AYg7a_section{max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;padding:24px 28px 40px;display:flex}.-AYg7a_sectionHeader,.-AYg7a_cardHeader,.-AYg7a_cardFooter,.-AYg7a_providerIdentity,.-AYg7a_actions,.-AYg7a_switchRow,.-AYg7a_switchControl{align-items:center;display:flex}.-AYg7a_sectionHeader,.-AYg7a_cardHeader,.-AYg7a_cardFooter{justify-content:space-between;gap:16px}.-AYg7a_sectionTitle,.-AYg7a_cardTitle{color:var(--dsw-alias-label-primary);margin:0;font-weight:600}.-AYg7a_sectionTitle{font-size:20px;line-height:28px}.-AYg7a_cardTitle{font-size:15px;line-height:22px}.-AYg7a_intro,.-AYg7a_empty,.-AYg7a_loading,.-AYg7a_notice,.-AYg7a_cardSubtitle,.-AYg7a_field small,.-AYg7a_switchRow small{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.-AYg7a_providerList{flex-direction:column;gap:12px;display:flex}.-AYg7a_providerCard,.-AYg7a_addCard{background:var(--dsw-alias-bg-module-platform);box-shadow:0 1px 0 var(--dsw-alias-border-l1);border-radius:14px;flex-direction:column;gap:16px;padding:16px;display:flex}.-AYg7a_addCard{border:1px solid var(--dsw-alias-border-l2)}.-AYg7a_providerIdentity{align-items:flex-start;gap:10px;min-width:0}.-AYg7a_statusDot{border-radius:50%;flex:none;width:8px;height:8px;margin-top:7px}.-AYg7a_statusDotActive{background:var(--dsw-alias-state-success-primary)}.-AYg7a_statusDotDormant{background:var(--dsw-alias-label-tertiary)}.-AYg7a_badge{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:2px 8px;font-size:12px;line-height:18px}.-AYg7a_cardSubtitle code,.-AYg7a_summaryGrid dd{font-family:var(--ds-font-family-code)}.-AYg7a_summaryGrid{border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:0;padding:12px 0;display:grid}.-AYg7a_summaryGrid div{min-width:0}.-AYg7a_summaryGrid dt{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.-AYg7a_summaryGrid dd{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:12px;line-height:18px;overflow:hidden}.-AYg7a_stateText{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.-AYg7a_switchRow,.-AYg7a_switchControl{gap:9px}.-AYg7a_switchRow{background:var(--dsw-alias-bg-layer-1);border-radius:10px;align-items:flex-start;padding:10px 12px}.-AYg7a_switchRow span{flex-direction:column;gap:2px;display:flex}.-AYg7a_switchControl{color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;font-size:12px;line-height:18px}.-AYg7a_formGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;display:grid}.-AYg7a_field{min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:5px;font-size:12px;line-height:18px;display:flex}.-AYg7a_fieldWide{grid-column:1/-1}.-AYg7a_input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;min-height:34px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:6px 10px}.-AYg7a_input:focus{border-color:var(--dsw-alias-brand-primary)}.-AYg7a_input:disabled,.-AYg7a_switchControl input:disabled,.-AYg7a_switchRow input:disabled{opacity:.55;cursor:default}.-AYg7a_fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin:0;padding:14px}.-AYg7a_fieldset legend{color:var(--dsw-alias-label-secondary);padding:0 5px;font-size:12px}.-AYg7a_actions{justify-content:flex-end;gap:8px}.-AYg7a_primaryButton,.-AYg7a_secondaryButton,.-AYg7a_addButton{min-height:36px;font:inherit;cursor:pointer;border-radius:18px;padding:0 14px;font-size:13px;line-height:20px}.-AYg7a_primaryButton{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:0}.-AYg7a_secondaryButton{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0}.-AYg7a_dangerButton{border:1px solid var(--dsw-alias-state-error-primary);min-height:36px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border-radius:18px;padding:0 14px;font-size:13px;line-height:20px}.-AYg7a_addButton{border:1px dashed var(--dsw-alias-border-l3);width:100%;color:var(--dsw-alias-label-secondary);background:0 0}.-AYg7a_primaryButton:hover:not(:disabled),.-AYg7a_secondaryButton:hover:not(:disabled),.-AYg7a_dangerButton:hover:not(:disabled),.-AYg7a_addButton:hover:not(:disabled){filter:brightness(.98)}.-AYg7a_dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.-AYg7a_primaryButton:focus-visible,.-AYg7a_secondaryButton:focus-visible,.-AYg7a_dangerButton:focus-visible,.-AYg7a_addButton:focus-visible,.-AYg7a_input:focus-visible,.-AYg7a_switchControl input:focus-visible,.-AYg7a_switchRow input:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}.-AYg7a_primaryButton:disabled,.-AYg7a_secondaryButton:disabled,.-AYg7a_dangerButton:disabled,.-AYg7a_addButton:disabled{opacity:.5;cursor:default}.-AYg7a_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}.-AYg7a_deleteDialog{width:min(480px,100%)}.-AYg7a_deleteConfirm:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}.-AYg7a_deleteConfirm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}.-AYg7a_editor{flex-direction:column;gap:14px;display:flex}.-AYg7a_editorHeader{align-items:baseline;gap:8px;display:flex}.-AYg7a_editorTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}.-AYg7a_editorRoute{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.-AYg7a_fieldLabel{color:var(--dsw-alias-label-secondary);align-items:center;gap:10px;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}.-AYg7a_staticInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);min-height:34px;color:var(--dsw-alias-label-secondary);font:inherit;border-radius:8px;align-items:center;padding:6px 10px;display:flex}.-AYg7a_advancedHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.-AYg7a_editorActions{justify-content:flex-end;gap:8px;display:flex}.-AYg7a_modelCatalog{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;padding-top:12px;display:flex}.-AYg7a_modelListHead{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.-AYg7a_modelCatalogHeading{flex-direction:column;gap:2px;display:flex}.-AYg7a_modelCatalogTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}.-AYg7a_modelCatalogMeta,.-AYg7a_modelEmpty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.-AYg7a_modelList{flex-direction:column;gap:8px;display:flex}.-AYg7a_modelEntry{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px}.-AYg7a_modelRow{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;align-items:center;gap:6px;display:grid}.-AYg7a_iconButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.-AYg7a_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.-AYg7a_iconButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.-AYg7a_iconButton:disabled{cursor:default;opacity:.4}.-AYg7a_modelAdvanced{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px 2px 2px;display:grid}.-AYg7a_modelField{flex-direction:column;gap:5px;min-width:0;display:flex}.-AYg7a_modelFieldLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.-AYg7a_linkButton,.-AYg7a_addModelButton{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);min-height:28px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;background:0 0;border-radius:14px;justify-content:center;align-items:center;gap:5px;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.-AYg7a_linkButton:hover:not(:disabled),.-AYg7a_addModelButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.-AYg7a_addModelButton{border-style:dashed;border-radius:8px;width:100%;min-height:36px}.-AYg7a_linkButton:disabled,.-AYg7a_addModelButton:disabled{cursor:default;opacity:.4}.-AYg7a_candidateList{flex-direction:column;gap:8px;max-height:320px;margin:0;padding:0;list-style:none;display:flex;overflow:auto}.-AYg7a_candidate{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}.-AYg7a_candidateLabel{color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:8px;display:flex}.-AYg7a_candidateId{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.-AYg7a_input:focus-visible,.-AYg7a_staticInput:focus-visible,.-AYg7a_linkButton:focus-visible,.-AYg7a_addModelButton:focus-visible,.-AYg7a_iconButton:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:2px}@media (width<=640px){.-AYg7a_section{padding:18px 16px 32px}.-AYg7a_formGrid,.-AYg7a_summaryGrid{grid-template-columns:1fr}.-AYg7a_fieldWide{grid-column:auto}.-AYg7a_modelRow{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto}.-AYg7a_modelAdvanced{grid-template-columns:repeat(2,minmax(0,1fr))}.-AYg7a_cardFooter{flex-direction:column;align-items:flex-start}}";
		const tagId$1 = "llm-openai-responses-bridge/BridgeSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"llm-openai-responses-bridge/BridgeSection.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "llm-openai-responses-bridge";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var BridgeSection_module_css_default = {
			"section": "-AYg7a_section",
			"advancedHint": "-AYg7a_advancedHint",
			"providerIdentity": "-AYg7a_providerIdentity",
			"secondaryButton": "-AYg7a_secondaryButton",
			"addCard": "-AYg7a_addCard",
			"candidateList": "-AYg7a_candidateList",
			"primaryButton": "-AYg7a_primaryButton",
			"editorRoute": "-AYg7a_editorRoute",
			"sectionTitle": "-AYg7a_sectionTitle",
			"modelField": "-AYg7a_modelField",
			"modelCatalogMeta": "-AYg7a_modelCatalogMeta",
			"fieldLabel": "-AYg7a_fieldLabel",
			"modelCatalogHeading": "-AYg7a_modelCatalogHeading",
			"linkButton": "-AYg7a_linkButton",
			"cardTitle": "-AYg7a_cardTitle",
			"deleteConfirm": "-AYg7a_deleteConfirm",
			"candidateLabel": "-AYg7a_candidateLabel",
			"staticInput": "-AYg7a_staticInput",
			"iconButtonDanger": "-AYg7a_iconButtonDanger",
			"dangerButton": "-AYg7a_dangerButton",
			"candidate": "-AYg7a_candidate",
			"iconButton": "-AYg7a_iconButton",
			"candidateId": "-AYg7a_candidateId",
			"summaryGrid": "-AYg7a_summaryGrid",
			"modelCatalog": "-AYg7a_modelCatalog",
			"modelEntry": "-AYg7a_modelEntry",
			"notice": "-AYg7a_notice",
			"modelFieldLabel": "-AYg7a_modelFieldLabel",
			"providerCard": "-AYg7a_providerCard",
			"modelCatalogTitle": "-AYg7a_modelCatalogTitle",
			"statusDotActive": "-AYg7a_statusDotActive",
			"editorTitle": "-AYg7a_editorTitle",
			"editorActions": "-AYg7a_editorActions",
			"modelList": "-AYg7a_modelList",
			"providerList": "-AYg7a_providerList",
			"fieldset": "-AYg7a_fieldset",
			"cardSubtitle": "-AYg7a_cardSubtitle",
			"formGrid": "-AYg7a_formGrid",
			"statusDotDormant": "-AYg7a_statusDotDormant",
			"empty": "-AYg7a_empty",
			"field": "-AYg7a_field",
			"switchRow": "-AYg7a_switchRow",
			"loading": "-AYg7a_loading",
			"badge": "-AYg7a_badge",
			"cardHeader": "-AYg7a_cardHeader",
			"fieldWide": "-AYg7a_fieldWide",
			"deleteDialog": "-AYg7a_deleteDialog",
			"input": "-AYg7a_input",
			"editor": "-AYg7a_editor",
			"stateText": "-AYg7a_stateText",
			"switchControl": "-AYg7a_switchControl",
			"editorHeader": "-AYg7a_editorHeader",
			"modelEmpty": "-AYg7a_modelEmpty",
			"addButton": "-AYg7a_addButton",
			"modelAdvanced": "-AYg7a_modelAdvanced",
			"modelListHead": "-AYg7a_modelListHead",
			"sectionHeader": "-AYg7a_sectionHeader",
			"intro": "-AYg7a_intro",
			"cardFooter": "-AYg7a_cardFooter",
			"actions": "-AYg7a_actions",
			"modelRow": "-AYg7a_modelRow",
			"statusDot": "-AYg7a_statusDot",
			"addModelButton": "-AYg7a_addModelButton",
			"error": "-AYg7a_error"
		};
		//#endregion
		//#region src/client/BridgeModelListEditor.tsx
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
		function textOf(model, key) {
			const value = model[key];
			return typeof value === "string" ? value : "";
		}
		function numberOf(model, key) {
			const value = model[key];
			return typeof value === "number" ? value : void 0;
		}
		function inputModeOf(model) {
			return model.input?.includes("image") === true ? "text-image" : "text";
		}
		function adopt(candidate) {
			return {
				id: candidate.id,
				...candidate.name === void 0 ? {} : { name: candidate.name },
				input: ["text"],
				...candidate.contextWindow === void 0 ? {} : { contextWindow: candidate.contextWindow },
				...candidate.maxTokens === void 0 ? {} : { maxTokens: candidate.maxTokens },
				reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS }
			};
		}
		function IconChevron({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				style: {
					transform: open ? "rotate(90deg)" : void 0,
					transition: "transform 120ms ease"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M6 3.5L10.5 8L6 12.5",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function IconTrash() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		function IconPlus() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 3v10M3 8h10",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})
			});
		}
		function keyFor(index, field) {
			return `${String(index)}:${field}`;
		}
		function reindexBuffers(current, removed) {
			const next = /* @__PURE__ */ new Map();
			for (const [key, value] of current) {
				const index = Number(key.slice(0, key.indexOf(":")));
				if (index === removed) continue;
				next.set(index > removed ? key.replace(/^\d+/u, String(index - 1)) : key, value);
			}
			return next;
		}
		/** Render Bridge model rows and the OpenAI-compatible /models picker. */
		function BridgeModelListEditor({ models, onChange, probe, probeBlocked, api, t, disabled }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const [candidates, setCandidates] = (0, react.useState)(void 0);
			const [picked, setPicked] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [editing, setEditing] = (0, react.useState)(/* @__PURE__ */ new Map());
			const patch = (index, next) => {
				onChange(models.map((model, at) => {
					if (at !== index) return { ...model };
					const copy = { ...model };
					for (const [key, value] of Object.entries(next)) if (key !== "id" && (value === void 0 || value === "")) delete copy[key];
					else copy[key] = value;
					return copy;
				}));
			};
			const editCapacity = (index, field, text) => {
				setEditing((current) => new Map(current).set(keyFor(index, field), text));
				patch(index, { [field]: parseCapacity(text) });
			};
			const capacityText = (model, index, field) => {
				return editing.get(keyFor(index, field)) ?? (numberOf(model, field) === void 0 ? "" : formatCapacity(numberOf(model, field)));
			};
			const fetchModels = async () => {
				setBusy(true);
				setFailure(void 0);
				try {
					const response = await api.llm.discoverModels({
						settingsNs: probe.settingsNs,
						...probe.baseURL === void 0 || probe.baseURL.trim().length === 0 ? {} : { baseURL: probe.baseURL.trim() },
						...probe.api === void 0 ? {} : { api: probe.api },
						...probe.apiKey === void 0 || probe.apiKey.trim().length === 0 ? {} : { apiKey: probe.apiKey.trim() }
					});
					if (!response.result.ok) {
						setFailure(response.result.error.message);
						return;
					}
					if (response.result.value.models.length === 0) {
						setFailure(t("fetchEmpty"));
						return;
					}
					const known = new Set(models.map((model) => textOf(model, "id")));
					setCandidates(response.result.value.models);
					setPicked(new Set(response.result.value.models.filter((model) => !known.has(model.id)).map((model) => model.id)));
				} catch (error) {
					setFailure(messageOf$2(error));
				} finally {
					setBusy(false);
				}
			};
			const closePicker = () => {
				setCandidates(void 0);
				setPicked(/* @__PURE__ */ new Set());
			};
			const adoptPicked = () => {
				if (candidates === void 0) return;
				const byId = new Map(models.map((model) => [textOf(model, "id"), model]));
				for (const candidate of candidates) if (picked.has(candidate.id) && !byId.has(candidate.id)) byId.set(candidate.id, adopt(candidate));
				onChange([...byId.values()]);
				closePicker();
			};
			const remove = (index) => {
				onChange(models.filter((_model, at) => at !== index));
				setExpanded((current) => new Set([...current].filter((at) => at !== index).map((at) => at > index ? at - 1 : at)));
				setEditing((current) => reindexBuffers(current, index));
			};
			const toggleExpanded = (index) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (!next.delete(index)) next.add(index);
					return next;
				});
			};
			const askable = probe.baseURL !== void 0 && probe.baseURL.trim().length > 0;
			const fetchDisabled = disabled || busy || !askable || probeBlocked !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: BridgeSection_module_css_default["modelCatalog"],
				"aria-label": t("models"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BridgeSection_module_css_default["modelListHead"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BridgeSection_module_css_default["modelCatalogHeading"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["modelCatalogTitle"],
								children: t("models")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["modelCatalogMeta"],
								children: probeBlocked ?? t("modelsHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: BridgeSection_module_css_default["linkButton"],
							disabled: fetchDisabled,
							title: probeBlocked ?? (askable ? void 0 : t("fetchNeedsBaseUrl")),
							onClick: () => {
								fetchModels();
							},
							children: busy ? t("fetching") : t("fetchModels")
						})]
					}),
					models.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["modelEmpty"],
						children: t("modelsEmpty")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: BridgeSection_module_css_default["modelList"],
						children: models.map((model, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BridgeSection_module_css_default["modelEntry"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: BridgeSection_module_css_default["modelRow"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: BridgeSection_module_css_default["input"],
										type: "text",
										value: textOf(model, "id"),
										placeholder: t("modelId"),
										"aria-label": `${t("modelId")} ${index + 1}`,
										disabled,
										onChange: (event) => {
											patch(index, { id: event.target.value });
										},
										onBlur: (event) => {
											const trimmed = event.target.value.trim();
											if (trimmed !== event.target.value) patch(index, { id: trimmed });
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: BridgeSection_module_css_default["input"],
										type: "text",
										value: textOf(model, "name"),
										placeholder: t("modelName"),
										"aria-label": `${t("modelName")} ${index + 1}`,
										disabled,
										onChange: (event) => {
											patch(index, { name: event.target.value });
										},
										onBlur: (event) => {
											if (event.target.value.trim() === "") patch(index, { name: void 0 });
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: BridgeSection_module_css_default["iconButton"],
										"aria-label": `${t("modelAdvanced")} ${index + 1}`,
										"aria-expanded": expanded.has(index),
										title: t("modelAdvanced"),
										onClick: () => {
											toggleExpanded(index);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevron, { open: expanded.has(index) })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: `${BridgeSection_module_css_default["iconButton"]} ${BridgeSection_module_css_default["iconButtonDanger"]}`,
										"aria-label": `${t("removeModel")} ${index + 1}`,
										title: t("removeModel"),
										disabled,
										onClick: () => {
											remove(index);
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconTrash, {})
									})
								]
							}), expanded.has(index) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: BridgeSection_module_css_default["modelAdvanced"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: BridgeSection_module_css_default["modelField"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: BridgeSection_module_css_default["modelFieldLabel"],
											children: t("modelInput")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											className: BridgeSection_module_css_default["input"],
											value: inputModeOf(model),
											disabled,
											"aria-label": `${t("modelInput")} ${index + 1}`,
											onChange: (event) => {
												patch(index, { input: event.target.value === "text-image" ? ["text", "image"] : ["text"] });
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "text",
												children: t("textOnly")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "text-image",
												children: t("textImage")
											})]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: BridgeSection_module_css_default["modelField"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: BridgeSection_module_css_default["modelFieldLabel"],
											children: t("contextWindow")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: BridgeSection_module_css_default["input"],
											type: "text",
											inputMode: "numeric",
											value: capacityText(model, index, "contextWindow"),
											placeholder: "256K",
											"aria-label": `${t("contextWindow")} ${index + 1}`,
											disabled,
											onChange: (event) => {
												editCapacity(index, "contextWindow", event.target.value);
											}
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: BridgeSection_module_css_default["modelField"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: BridgeSection_module_css_default["modelFieldLabel"],
											children: t("maxTokens")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: BridgeSection_module_css_default["input"],
											type: "text",
											inputMode: "numeric",
											value: capacityText(model, index, "maxTokens"),
											placeholder: "32K",
											"aria-label": `${t("maxTokens")} ${index + 1}`,
											disabled,
											onChange: (event) => {
												editCapacity(index, "maxTokens", event.target.value);
											}
										})]
									})
								]
							}) : null]
						}, index))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: BridgeSection_module_css_default["addModelButton"],
						disabled,
						onClick: () => {
							onChange([...models, {
								id: "",
								input: ["text"],
								reasoningEfforts: { ...DEFAULT_REASONING_EFFORTS }
							}]);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconPlus, {}),
							" ",
							t("addModel")
						]
					}),
					failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["error"],
						role: "alert",
						children: failure
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: candidates !== void 0,
						onClose: closePicker,
						title: t("fetchTitle"),
						closeLabel: t("close"),
						description: t("fetchDescription"),
						className: BridgeSection_module_css_default["fetchDialog"],
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: closePicker,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							onClick: adoptPicked,
							children: t("fetchAdopt")
						})] }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: BridgeSection_module_css_default["candidateList"],
							children: (candidates ?? []).map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
								className: BridgeSection_module_css_default["candidate"],
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: BridgeSection_module_css_default["candidateLabel"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: picked.has(candidate.id),
										onChange: () => {
											setPicked((current) => {
												const next = new Set(current);
												if (!next.delete(candidate.id)) next.add(candidate.id);
												return next;
											});
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: BridgeSection_module_css_default["candidateId"],
										children: candidate.id
									})]
								})
							}, candidate.id))
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/AddCustomProviderCard.tsx
		function messageOf$1(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function setField(setDraft, key, value) {
			setDraft((current) => ({
				...current,
				[key]: value
			}));
		}
		/** Native-shaped creation card whose persistence seam is owned by the Bridge. */
		function AddCustomProviderCard({ namespace, existingRoutes, writable, api, t, mode = "create", route, profile: initialProfile, credentialConfigured = false, onCancel, onSaved }) {
			const editing = mode === "edit";
			const [draft, setDraft] = (0, react.useState)(() => editing && initialProfile !== void 0 && route !== void 0 ? providerDraftFromProfile(route, initialProfile) : initialProviderDraft());
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const [committed, setCommitted] = (0, react.useState)(false);
			const validation = (0, react.useMemo)(() => validateProviderDraft(draft, existingRoutes, { requireApiKey: !editing }), [
				draft,
				editing,
				existingRoutes
			]);
			const disabled = busy || !writable;
			const profileDisabled = disabled || committed;
			const existingProfile = editing ? initialProfile : void 0;
			const title = editing ? t("edit") : t("add");
			const googleProtocol = draft.api === "google-generative-ai";
			const validationVisible = validation !== void 0 && (validation.field === "route" && draft.route.trim().length > 0 || validation.field === "baseURL" && draft.baseURL.trim().length > 0 || validation.field === "apiKey" && draft.apiKey.trim().length > 0 || validation.field === "models" && draft.models.length > 0);
			const save = async () => {
				if (disabled || validation !== void 0) return;
				setBusy(true);
				setFailure(void 0);
				try {
					const draftProfile = providerProfileFromDraft(draft);
					if (!committed) {
						const response = await api.settings.mutate({
							ns: namespace.ns,
							ops: editing ? providerEditOps(draft.route.trim(), existingProfile, draft) : [{
								op: "set",
								path: ["providers", draft.route.trim()],
								value: draftProfile
							}],
							expectedRevision: namespace.revision
						});
						if (!response.result.ok) {
							setFailure(response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message);
							return;
						}
						setCommitted(true);
					}
					if (draft.apiKey.trim().length > 0) {
						const ref = editing ? existingProfile?.apiKeyEnv ?? draftProfile.apiKeyEnv : draftProfile.apiKeyEnv;
						const stored = await api.credentials.set({
							ref,
							value: draft.apiKey.trim()
						});
						if (!stored.result.ok) {
							setFailure(t("savedWithCredentialFailure").replace("{error}", stored.result.error.message));
							return;
						}
					}
					onSaved();
				} catch (error) {
					setFailure(messageOf$1(error));
				} finally {
					setBusy(false);
				}
			};
			const changeModels = (models) => {
				setField(setDraft, "models", models);
			};
			const changeProtocol = (api) => {
				setDraft((current) => ({
					...current,
					api,
					...api === "google-generative-ai" ? { webSearch: false } : {}
				}));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("form", {
				className: BridgeSection_module_css_default["addCard"],
				onSubmit: (event) => {
					event.preventDefault();
					save();
				},
				"aria-label": title,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: BridgeSection_module_css_default["editor"],
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BridgeSection_module_css_default["editorHeader"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["editorTitle"],
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["editorRoute"],
								children: draft.route || t("custom")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["field"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["fieldLabel"],
									children: t("providerId")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: BridgeSection_module_css_default["input"],
									type: "text",
									value: draft.route,
									placeholder: "acme-gateway",
									"aria-label": t("providerId"),
									"aria-describedby": "bridge-provider-id-hint",
									disabled: profileDisabled || editing,
									onChange: (event) => {
										setField(setDraft, "route", event.target.value);
									},
									required: true
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["advancedHint"],
									id: "bridge-provider-id-hint",
									children: t("providerIdHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["field"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["fieldLabel"],
								children: t("displayName")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: BridgeSection_module_css_default["input"],
								type: "text",
								value: draft.displayName,
								placeholder: draft.route || t("displayName"),
								"aria-label": t("displayName"),
								disabled: profileDisabled,
								onChange: (event) => {
									setField(setDraft, "displayName", event.target.value);
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["field"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["fieldLabel"],
									children: t("baseURL")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: BridgeSection_module_css_default["input"],
									type: "url",
									value: draft.baseURL,
									placeholder: "https://gateway.example/v1",
									"aria-label": t("baseURL"),
									"aria-describedby": "bridge-base-url-hint",
									disabled: profileDisabled,
									onChange: (event) => {
										setField(setDraft, "baseURL", event.target.value);
									},
									required: true
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["advancedHint"],
									id: "bridge-base-url-hint",
									children: t(googleProtocol ? "baseURLGoogleHint" : "baseURLHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["field"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["fieldLabel"],
									children: t("apiProtocol")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: BridgeSection_module_css_default["input"],
									value: draft.api,
									"aria-label": t("apiProtocol"),
									"aria-describedby": "bridge-api-protocol-hint",
									disabled: profileDisabled,
									onChange: (event) => {
										changeProtocol(event.target.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "google-generative-ai",
										children: t("apiProtocolGoogle")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "openai-responses",
										children: t("apiProtocolOpenAI")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["advancedHint"],
									id: "bridge-api-protocol-hint",
									children: t(googleProtocol ? "apiProtocolGoogleHint" : "apiProtocolHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["field"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["fieldLabel"],
									children: t("apiKey")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: BridgeSection_module_css_default["input"],
									type: "password",
									value: draft.apiKey,
									autoComplete: "new-password",
									placeholder: "••••••••",
									"aria-label": t("apiKey"),
									"aria-describedby": "bridge-api-key-hint",
									disabled,
									onChange: (event) => {
										setField(setDraft, "apiKey", event.target.value);
									},
									required: !editing
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: BridgeSection_module_css_default["advancedHint"],
									id: "bridge-api-key-hint",
									children: editing ? t(credentialConfigured ? "apiKeyEditConfiguredHint" : "apiKeyEditMissingHint") : t("apiKeyHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BridgeModelListEditor, {
							models: draft.models,
							onChange: changeModels,
							probe: {
								settingsNs: BRIDGE_SETTINGS_NS,
								baseURL: draft.baseURL,
								api: googleProtocol ? "google-generative-ai" : "openai-responses-bridge",
								...draft.apiKey.trim().length === 0 ? {} : { apiKey: draft.apiKey }
							},
							...googleProtocol ? { probeBlocked: t("fetchModelsGoogleHint") } : {},
							api,
							t,
							disabled: profileDisabled
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: BridgeSection_module_css_default["switchRow"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: !googleProtocol && draft.webSearch,
								onChange: (event) => {
									setField(setDraft, "webSearch", event.target.checked);
								},
								disabled: profileDisabled || googleProtocol
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("webSearch") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t(googleProtocol ? "webSearchGoogleHint" : "webSearchHint") })] })]
						}),
						validationVisible ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BridgeSection_module_css_default["error"],
							role: "alert",
							"aria-live": "polite",
							children: validation.message
						}) : null,
						failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BridgeSection_module_css_default["error"],
							role: "alert",
							children: failure
						}),
						!writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BridgeSection_module_css_default["notice"],
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BridgeSection_module_css_default["editorActions"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: BridgeSection_module_css_default["secondaryButton"],
								onClick: onCancel,
								disabled: busy,
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: BridgeSection_module_css_default["primaryButton"],
								disabled: disabled || validation !== void 0,
								children: busy ? t("saving") : t("save")
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/ProviderSummaryCard.tsx
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		/** Route summary with Bridge-owned edit, delete, and web_search actions. */
		function ProviderSummaryCard({ route, profile, credentialRef, credential, active, namespace, writable, api, t, onChanged }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)(void 0);
			const [deleteOpen, setDeleteOpen] = (0, react.useState)(false);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deleteFailure, setDeleteFailure] = (0, react.useState)(void 0);
			const summary = summaryOf(profile);
			const configured = credential?.configured === true;
			const credentialLabel = credential?.writable === false ? t("credentialReadOnly") : configured ? t("credentialConfigured") : t("credentialMissing");
			const providerLabel = profile.displayName === void 0 || profile.displayName === route ? route : `${profile.displayName} (${route})`;
			const googleProtocol = profile.api === "google-generative-ai";
			const protocolLabel = t(googleProtocol ? "apiProtocolGoogle" : "apiProtocolOpenAI");
			const managedCredentialRef = profile.apiKeyEnv === deriveApiKeyRef(route) && credential?.writable === true ? profile.apiKeyEnv : void 0;
			if (editing) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddCustomProviderCard, {
				namespace,
				existingRoutes: [],
				writable,
				api,
				t,
				mode: "edit",
				route,
				profile,
				credentialConfigured: configured,
				onCancel: () => {
					setEditing(false);
				},
				onSaved: () => {
					setEditing(false);
					onChanged();
				}
			});
			const toggle = async (enabled) => {
				if (busy || deleting || !writable) return;
				setBusy(true);
				setFailure(void 0);
				try {
					const response = await api.settings.mutate({
						ns: namespace.ns,
						ops: webSearchOps(route, profile, enabled),
						expectedRevision: namespace.revision
					});
					if (!response.result.ok) {
						setFailure(response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message);
						return;
					}
					onChanged();
				} catch (error) {
					setFailure(messageOf(error));
				} finally {
					setBusy(false);
				}
			};
			const openDelete = () => {
				if (busy || deleting || !writable) return;
				setDeleteFailure(void 0);
				setDeleteOpen(true);
			};
			const closeDelete = () => {
				if (deleting) return;
				setDeleteOpen(false);
				setDeleteFailure(void 0);
			};
			const confirmDelete = async () => {
				if (busy || deleting || !writable) return;
				setDeleting(true);
				setDeleteFailure(void 0);
				try {
					if (managedCredentialRef !== void 0) {
						const credential = await api.credentials.unset({ ref: managedCredentialRef });
						if (!credential.result.ok) {
							setDeleteFailure(credential.result.error.message);
							return;
						}
					}
					const response = await api.settings.mutate({
						ns: namespace.ns,
						ops: providerDeleteOps(route),
						expectedRevision: namespace.revision
					});
					if (!response.result.ok) {
						setDeleteFailure(response.result.error.code === "settings-conflict" ? t("conflict") : response.result.error.message);
						return;
					}
					setDeleteOpen(false);
					onChanged();
				} catch (error) {
					setDeleteFailure(messageOf(error));
				} finally {
					setDeleting(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: BridgeSection_module_css_default["providerCard"],
				"aria-label": `${profile.displayName ?? route} (${route})`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BridgeSection_module_css_default["cardHeader"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: BridgeSection_module_css_default["providerIdentity"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${BridgeSection_module_css_default["statusDot"]} ${active ? BridgeSection_module_css_default["statusDotActive"] : BridgeSection_module_css_default["statusDotDormant"]}`,
								"aria-hidden": "true"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: BridgeSection_module_css_default["cardTitle"],
								children: profile.displayName ?? route
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: BridgeSection_module_css_default["cardSubtitle"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: route }),
									" · ",
									protocolLabel
								]
							})] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: BridgeSection_module_css_default["badge"],
							children: t("custom")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
						className: BridgeSection_module_css_default["summaryGrid"],
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("baseURL") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
								title: summary.baseURL,
								children: summary.baseURL || "—"
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("modelId") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: summary.model })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("apiKey") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: credentialLabel })] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: BridgeSection_module_css_default["cardFooter"],
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: BridgeSection_module_css_default["stateText"],
								children: [
									active ? t("active") : t("dormant"),
									" · ",
									credentialLabel
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: BridgeSection_module_css_default["secondaryButton"],
								onClick: () => {
									setEditing(true);
								},
								disabled: busy || deleting || !writable,
								children: t("edit")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: BridgeSection_module_css_default["dangerButton"],
								onClick: openDelete,
								disabled: busy || deleting || !writable,
								"aria-label": `${t("delete")}: ${route}`,
								children: t("delete")
							}),
							googleProtocol ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: BridgeSection_module_css_default["stateText"],
								title: t("webSearchGoogleHint"),
								children: t("webSearchUnavailable")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: BridgeSection_module_css_default["switchControl"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: webSearchEnabled(profile),
									onChange: (event) => {
										toggle(event.target.checked);
									},
									disabled: busy || deleting || !writable,
									"aria-label": `${t("webSearch")}: ${route}`
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: busy ? t("toggleSaving") : t("webSearch") })]
							})
						]
					}),
					failure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["error"],
						role: "alert",
						children: failure
					}),
					credentialRef === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["notice"],
						children: t("noCredential")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: deleteOpen,
						onClose: closeDelete,
						title: t("deleteTitle").replace("{provider}", providerLabel),
						closeLabel: t("close"),
						description: (managedCredentialRef === void 0 ? t("deleteDescription") : t("deleteDescriptionWithCredential")).replace("{provider}", providerLabel),
						className: BridgeSection_module_css_default["deleteDialog"],
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							autoFocus: true,
							disabled: deleting,
							onClick: closeDelete,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							className: BridgeSection_module_css_default["deleteConfirm"],
							disabled: deleting,
							onClick: () => {
								confirmDelete();
							},
							children: (deleting ? t("deleting") : t("deleteConfirm")).replace("{provider}", providerLabel)
						})] }),
						children: deleteFailure === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BridgeSection_module_css_default["error"],
							role: "alert",
							children: deleteFailure
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/BridgeSection.tsx
		/** Standalone settings section; it never renders inside native ModelsSection. */
		function BridgeSection(props) {
			const { controller, useSnapshot, api, t } = props;
			if (controller === void 0 || useSnapshot === void 0 || api === void 0 || t === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Loaded, {
				controller,
				useSnapshot,
				api,
				t
			});
		}
		function Loaded({ controller, useSnapshot, api, t }) {
			const state = useSnapshot((snapshot) => snapshot);
			const [adding, setAdding] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (state.status === "idle") controller.load();
			}, [controller, state.status]);
			if (state.status === "idle" || state.status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: BridgeSection_module_css_default["section"],
				"aria-busy": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BridgeSection_module_css_default["loading"],
					children: t("loading")
				})
			});
			if (state.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: BridgeSection_module_css_default["section"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BridgeSection_module_css_default["error"],
					role: "alert",
					children: `${t("loadFailed")}: ${state.error ?? ""}`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: BridgeSection_module_css_default["secondaryButton"],
					onClick: () => {
						controller.load();
					},
					children: t("retry")
				})]
			});
			if (state.status === "missing" || state.namespace === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: BridgeSection_module_css_default["section"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: BridgeSection_module_css_default["sectionTitle"],
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: BridgeSection_module_css_default["intro"],
					children: t("namespaceMissing")
				})]
			});
			const routeIds = state.routes.map((route) => route.route);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: BridgeSection_module_css_default["section"],
				"aria-labelledby": "bridge-section-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
						className: BridgeSection_module_css_default["sectionHeader"],
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "bridge-section-title",
							className: BridgeSection_module_css_default["sectionTitle"],
							children: t("title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: BridgeSection_module_css_default["intro"],
							children: t("intro")
						})] })
					}),
					state.routes.length === 0 && !adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["empty"],
						children: t("empty")
					}) : null,
					state.routes.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: BridgeSection_module_css_default["providerList"],
						"aria-label": t("added"),
						children: state.routes.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderSummaryCard, {
							...row,
							namespace: state.namespace,
							writable: state.writable,
							api,
							t,
							onChanged: () => {
								controller.load();
							}
						}, row.route))
					}) : null,
					adding ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddCustomProviderCard, {
						namespace: state.namespace,
						existingRoutes: routeIds,
						writable: state.writable,
						api,
						t,
						onCancel: () => {
							setAdding(false);
						},
						onSaved: () => {
							setAdding(false);
							controller.load();
						}
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: BridgeSection_module_css_default["addButton"],
						onClick: () => {
							setAdding(true);
						},
						disabled: !state.writable,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								children: "＋"
							}),
							" ",
							t("add")
						]
					}),
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: BridgeSection_module_css_default["notice"],
						children: t("readOnly")
					}) : null
				]
			});
		}
		//#endregion
		//#region \0dsh-bridge-css:llm-openai-responses-bridge/HostedWebSearchCard.module.css.mjs
		const css = ".bA6vwq_root{width:100%;color:var(--dsw-text-primary)}.bA6vwq_row{min-height:24px}.bA6vwq_leading{color:var(--dsw-text-secondary)}.bA6vwq_title{font-weight:500}.bA6vwq_chevron{color:var(--dsw-text-tertiary)}.bA6vwq_separator{background:var(--dsw-text-tertiary);opacity:.65;border-radius:50%;width:3px;height:3px;margin:0 7px}.bA6vwq_summary,.bA6vwq_status{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.bA6vwq_summary{max-width:360px;color:var(--dsw-text-secondary)}.bA6vwq_status{color:var(--dsw-text-tertiary)}.bA6vwq_body{padding:4px 0 8px 28px}.bA6vwq_meta{color:var(--dsw-text-tertiary);margin-bottom:6px;font-size:12px}.bA6vwq_error{color:var(--dsw-color-error,#c43d3d);white-space:pre-wrap;margin:8px 0 0}";
		const tagId = "llm-openai-responses-bridge/HostedWebSearchCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"llm-openai-responses-bridge/HostedWebSearchCard.module.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "llm-openai-responses-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var HostedWebSearchCard_module_css_default = {
			"row": "bA6vwq_row",
			"meta": "bA6vwq_meta",
			"title": "bA6vwq_title",
			"chevron": "bA6vwq_chevron",
			"separator": "bA6vwq_separator",
			"leading": "bA6vwq_leading",
			"summary": "bA6vwq_summary",
			"body": "bA6vwq_body",
			"root": "bA6vwq_root",
			"status": "bA6vwq_status",
			"error": "bA6vwq_error"
		};
		//#endregion
		//#region src/client/HostedWebSearchCard.tsx
		function statusLabel(status) {
			if (status === "completed") return "搜索完成";
			if (status === "failed") return "搜索失败";
			if (status === "aborted") return "搜索已中断";
			if (status === "searching") return "正在搜索";
			return "搜索中";
		}
		function sourceViews(data) {
			const result = data.sources.map((source) => ({
				url: source.url,
				...source.title === void 0 ? {} : { title: source.title },
				...source.snippet === void 0 ? {} : { snippet: source.snippet },
				...source.publishedAt === void 0 ? {} : { publishedAt: source.publishedAt }
			}));
			const seen = new Set(result.map((source) => source.url));
			for (const citation of data.citations) {
				if (seen.has(citation.url)) continue;
				seen.add(citation.url);
				result.push({
					url: citation.url,
					...citation.title === void 0 ? {} : { title: citation.title },
					...citation.quotedText === void 0 ? {} : { snippet: citation.quotedText }
				});
			}
			return result;
		}
		function HostedWebSearchCard({ data }) {
			const [open, setOpen] = (0, react.useState)(false);
			const sources = sourceViews(data);
			const summary = data.queries.at(-1) ?? statusLabel(data.status);
			const expandable = sources.length > 0 || data.error !== void 0 || data.status !== "in_progress";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: HostedWebSearchCard_module_css_default.root,
				"data-hosted-web-search": true,
				"data-status": data.status,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					rowClassName: HostedWebSearchCard_module_css_default.row,
					leadingClassName: HostedWebSearchCard_module_css_default.leading,
					titleClassName: HostedWebSearchCard_module_css_default.title,
					chevronClassName: HostedWebSearchCard_module_css_default.chevron,
					icon: data.status === "in_progress" || data.status === "searching" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 14 }),
					title: "Web Search Openai",
					open,
					expandable,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setOpen((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HostedWebSearchCard_module_css_default.separator,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HostedWebSearchCard_module_css_default.summary,
							children: summary
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HostedWebSearchCard_module_css_default.separator,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HostedWebSearchCard_module_css_default.status,
							children: statusLabel(data.status)
						}),
						sources.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: HostedWebSearchCard_module_css_default.separator,
							"aria-hidden": true
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: HostedWebSearchCard_module_css_default.status,
							children: [sources.length, " 个来源"]
						})] })
					] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: HostedWebSearchCard_module_css_default.body,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: HostedWebSearchCard_module_css_default.meta,
								children: [
									data.provider,
									" · ",
									data.model
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.WebBlock, {
								kind: "search",
								sources,
								truncated: data.truncated === true
							}),
							data.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: HostedWebSearchCard_module_css_default.error,
								children: data.error.message
							})
						]
					})
				})
			});
		}
		//#endregion
		//#region src/client/HostedWebSearchDefinition.ts
		function viewData(state) {
			return {
				provider: state.provider,
				model: state.model,
				status: state.status,
				queries: state.queries,
				sources: state.sources,
				citations: state.citations,
				...state.truncated === void 0 ? {} : { truncated: state.truncated },
				...state.error === void 0 ? {} : { error: state.error }
			};
		}
		function locationOf(context) {
			return context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
		}
		const hostedWebSearchDefinition = {
			kind: "bridge-hosted-web-search",
			target: "chat",
			match: (event) => {
				if (event.type === "bridge/hosted-web-search/start") return {
					id: event.data.searchId,
					role: "start"
				};
				if (event.type === "bridge/hosted-web-search/update" || event.type === "bridge/hosted-web-search/end") return {
					id: event.data.searchId,
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "bridge/hosted-web-search/start") throw new Error("hosted web search requires a start event");
				return match.event.data;
			},
			update: (_context, match) => {
				if (match.event.type !== "bridge/hosted-web-search/update" && match.event.type !== "bridge/hosted-web-search/end") throw new Error("unexpected hosted web search update");
				return match.event.data;
			},
			publication: (match) => match.event.type === "bridge/hosted-web-search/end" ? "immediate" : "animation-frame",
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				return {
					key: context.key,
					kind: "bridge-hosted-web-search",
					id: context.id,
					target: "chat",
					anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
					location: locationOf(context),
					visibility: "visible",
					data: viewData(context.state)
				};
			}
		};
		//#endregion
		//#region src/client/HostedWebSearchNode.tsx
		function HostedWebSearchNodeView({ node }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HostedWebSearchCard, { data: node.data });
		}
		/** Register the durable assembler Definition and its keyed chat renderer. */
		function registerHostedWebSearchConversationNode(ctx) {
			ctx.conversationEvents.register(hostedWebSearchDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "bridge-hosted-web-search",
				locale: "conversation"
			}, HostedWebSearchNodeView));
		}
		//#endregion
		//#region src/client/locales.ts
		/** Product copy owned by the Bridge settings section. */
		const en = {
			nav: "Third-party models",
			title: "Third-party models",
			intro: "Add a Google Generative AI or OpenAI Responses provider without changing DSH’s native API protocol list.",
			add: "Add custom provider",
			edit: "Edit",
			delete: "Delete",
			deleteTitle: "Delete {provider}?",
			deleteDescription: "Deleting {provider} removes its Bridge configuration. Existing credentials are kept.",
			deleteDescriptionWithCredential: "Deleting {provider} removes its Bridge configuration and the API key stored by this settings card.",
			deleteConfirm: "Delete {provider}",
			deleting: "Deleting {provider}…",
			added: "Added custom providers",
			empty: "No third-party provider has been added yet.",
			custom: "Custom",
			active: "Active",
			dormant: "Waiting for a valid route",
			credentialConfigured: "Credential configured",
			credentialMissing: "Credential missing",
			credentialReadOnly: "Credential is read-only",
			apiProtocol: "API protocol",
			apiProtocolOpenAI: "OpenAI Responses (Bridge)",
			apiProtocolGoogle: "Google Generative AI",
			apiProtocolHint: "Uses the Bridge’s native Pi OpenAI Responses route; DSH’s native API list is unchanged.",
			apiProtocolGoogleHint: "Uses Pi’s native Gemini generateContent route; DSH’s native API list is unchanged.",
			providerId: "Provider ID",
			providerIdHint: "Lowercase letters, digits, and dashes; this route name cannot be changed later.",
			displayName: "Display name",
			baseURL: "API address",
			baseURLHint: "Native Pi appends /responses to this base URL; do not include /responses here.",
			baseURLGoogleHint: "Use the Gemini native endpoint, including its version path such as /v1beta; do not add /responses.",
			apiKey: "API key",
			apiKeyHint: "The key is written to DSH credentials and is never stored in settings or shown again.",
			apiKeyEditConfiguredHint: "Leave blank to keep the configured key. Enter a value only to replace it.",
			apiKeyEditMissingHint: "No key is currently configured. Leave blank to keep that state, or enter a new key.",
			modelId: "Model ID",
			modelName: "Model display name",
			modelInput: "Input type",
			textOnly: "Text",
			textImage: "Text + image",
			models: "Models",
			modelsHint: "Add models manually or fetch the endpoint model directory.",
			modelsEmpty: "No model has been added yet.",
			modelAdvanced: "Advanced model settings",
			removeModel: "Remove model",
			addModel: "Add model",
			fetchModels: "Fetch available models",
			fetching: "Fetching…",
			fetchNeedsBaseUrl: "Enter an API address first.",
			fetchEmpty: "The endpoint returned no models.",
			fetchModelsGoogleHint: "Google Generative AI model discovery is not available through the Bridge /models probe; enter models manually.",
			fetchTitle: "Available models",
			fetchDescription: "Choose the models to add to this Bridge provider.",
			fetchAdopt: "Add selected models",
			contextWindow: "Context window",
			maxTokens: "Max output tokens",
			webSearch: "Enable web_search",
			webSearchHint: "Remote hosted search is off by default and may incur provider charges.",
			webSearchGoogleHint: "Google Generative AI does not accept the Bridge hosted web_search definition; this option is unavailable for this route.",
			webSearchUnavailable: "web_search unavailable for Google",
			save: "Save provider",
			saving: "Saving…",
			cancel: "Cancel",
			toggleSaving: "Updating…",
			loadFailed: "Could not load Bridge settings",
			loading: "Loading Bridge settings…",
			namespaceMissing: "The Bridge settings namespace is not available in this profile.",
			readOnly: "Settings are read-only in this deployment.",
			retry: "Retry",
			conflict: "These settings changed elsewhere. Reloaded the latest values; please submit again.",
			savedWithCredentialFailure: "Provider settings were saved, but the credential could not be written: {error}",
			noCredential: "No API key is configured for this provider. The key is never sent back to the browser.",
			close: "Close"
		};
		const zh = {
			nav: "第三方模型",
			title: "第三方模型",
			intro: "添加 Google Generative AI 或 OpenAI Responses 提供方，不改变 DSH 原生 API 协议列表。",
			add: "添加自定义提供方",
			edit: "编辑",
			delete: "删除",
			deleteTitle: "删除 {provider}？",
			deleteDescription: "删除 {provider} 会移除 Bridge 配置；已有 credential 会保留。",
			deleteDescriptionWithCredential: "删除 {provider} 会移除 Bridge 配置和设置卡保存的 API 密钥。",
			deleteConfirm: "删除 {provider}",
			deleting: "正在删除 {provider}…",
			added: "已添加的自定义提供方",
			empty: "还没有添加第三方提供方。",
			custom: "自定义",
			active: "已生效",
			dormant: "等待有效 route",
			credentialConfigured: "凭据已配置",
			credentialMissing: "凭据未配置",
			credentialReadOnly: "凭据为只读",
			apiProtocol: "API 协议",
			apiProtocolOpenAI: "OpenAI Responses（Bridge）",
			apiProtocolGoogle: "Google Generative AI",
			apiProtocolHint: "使用 Bridge 内置的 Pi OpenAI Responses 路由，不会修改 DSH 原生 API 协议列表。",
			apiProtocolGoogleHint: "使用 Pi 原生 Gemini generateContent 路由，不会修改 DSH 原生 API 协议列表。",
			providerId: "Provider ID",
			providerIdHint: "使用小写字母、数字和短横线；保存后不能修改 route 名称。",
			displayName: "显示名称",
			baseURL: "API 地址",
			baseURLHint: "Pi 原生实现会在该地址后追加 /responses；这里不要填写 /responses。",
			baseURLGoogleHint: "填写 Gemini 原生接口地址，并包含 /v1beta 等版本路径；这里不要填写 /responses。",
			apiKey: "API 密钥",
			apiKeyHint: "密钥只会写入 DSH credentials，不会保存到普通设置或再次显示。",
			apiKeyEditConfiguredHint: "留空表示保留当前已配置的密钥；只有输入新值时才会替换。",
			apiKeyEditMissingHint: "当前没有已配置的密钥；留空保持现状，也可以输入新密钥。",
			modelId: "模型 ID",
			modelName: "模型显示名称",
			modelInput: "输入类型",
			textOnly: "文本",
			textImage: "文本 + 图片",
			models: "模型目录",
			modelsHint: "可以手动添加模型，也可以从服务端获取模型目录。",
			modelsEmpty: "还没有添加模型。",
			modelAdvanced: "模型高级设置",
			removeModel: "删除模型",
			addModel: "添加模型",
			fetchModels: "获取可用模型",
			fetching: "获取中…",
			fetchNeedsBaseUrl: "请先填写 API 地址。",
			fetchEmpty: "服务端没有返回模型。",
			fetchModelsGoogleHint: "Google Generative AI 暂不支持通过 Bridge /models 探测模型，请手动填写模型。",
			fetchTitle: "可用模型",
			fetchDescription: "选择要添加到这个 Bridge 提供方的模型。",
			fetchAdopt: "添加选中模型",
			contextWindow: "上下文窗口",
			maxTokens: "最大输出 token 数",
			webSearch: "启用 web_search",
			webSearchHint: "远端 hosted 搜索默认关闭，开启后可能产生服务商费用。",
			webSearchGoogleHint: "Google Generative AI 不接受 Bridge hosted web_search 定义，此协议不可用该选项。",
			webSearchUnavailable: "Google 不支持 web_search",
			save: "保存提供方",
			saving: "保存中…",
			cancel: "取消",
			toggleSaving: "更新中…",
			loadFailed: "无法加载 Bridge 设置",
			loading: "正在加载 Bridge 设置…",
			namespaceMissing: "当前 profile 没有提供 Bridge settings namespace。",
			readOnly: "当前部署的设置为只读。",
			retry: "重试",
			conflict: "设置已在其他窗口被修改。已重新加载最新值，请再次提交。",
			savedWithCredentialFailure: "提供方设置已保存，但凭据写入失败：{error}",
			noCredential: "此提供方尚未配置 API 密钥；密钥不会回传到浏览器。",
			close: "关闭"
		};
		//#endregion
		//#region src/client/index.ts
		const COPY_NS = "settings.openai-responses-bridge";
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"conversationEvents"
		];
		/** Register the standalone section and keep it converged with Host invalidations. */
		function apply(ctx) {
			registerHostedWebSearchConversationNode(ctx);
			ctx.effect(() => ctx.locale.register(COPY_NS, {
				zh,
				en
			}), "openai-responses-bridge: copy dictionaries");
			const connection = ctx.get("connection");
			const controller = new BridgeSettingsStore(connection.api);
			const useSnapshot = (0, _deepseek_ai_dsh_client_web_react.bindSnapshotSelector)(controller.store);
			const t = ctx.locale.bind(COPY_NS);
			const injected = () => ({
				controller,
				useSnapshot,
				api: connection.api,
				t
			});
			ctx.effect(() => {
				const refresh = () => {
					refreshIfLoaded(controller);
				};
				const disposers = [
					ctx.remote.$on("settings/document-updated", (ns) => {
						if (ns === "llm-openai-responses-bridge") refresh();
					}),
					ctx.remote.$on("credentials/updated", refresh),
					ctx.remote.$on("llm/adapters-updated", refresh),
					ctx.on("connection/reset", refresh)
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "openai-responses-bridge: pushed invalidations");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-responses-bridge",
				order: 20,
				label: () => t("nav"),
				inject: injected
			}, BridgeSection));
		}
		var client_default = {
			inject,
			apply
		};
		//#endregion
		exports.apply = apply;
		exports.default = client_default;
		exports.inject = inject;
		return module.exports;
	}
});
