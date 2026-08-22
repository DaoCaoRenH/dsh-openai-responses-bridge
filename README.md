# dsh-openai-responses-bridge

An independent DeepSeek Harness plugin for connecting third-party models through
the OpenAI Responses protocol or the native Gemini Generative AI protocol.

The DSH plugin id is `llm-openai-responses-bridge`. It works through DSH plugin
interfaces and does not modify the DeepSeek Harness source tree.

[中文说明](README.zh.md) | [Security](SECURITY.md) | [License](LICENSE)

## Features

- Add third-party OpenAI Responses providers without changing DSH's native
  provider list.
- Add native Gemini providers in the same Bridge settings section.
- Reuse DSH/Pi native message conversion, reasoning, tool conversion, replay,
  usage, and stream error handling.
- Enable the remote Responses `web_search` tool and display its lifecycle,
  queries, citations, sources, and errors in a DSH conversation card.
- Discover models from an OpenAI-compatible `/models` endpoint and select them
  before saving a provider.
- Store API keys through DSH credentials while keeping the settings file free
  of secret values.
- Include the `dsh-pwsh-sandbox-schem` compatibility behavior in the same
  plugin; no second shim plugin is required.
- Hot-reload provider settings without changing the host source code.

## How it works

### Protocol routing

Each route in the `llm-openai-responses-bridge` namespace chooses one native
Pi protocol:

| Route protocol | Upstream request | Hosted OpenAI tools |
| --- | --- | --- |
| `openai-responses` | OpenAI Responses `POST /responses` | Supported when enabled |
| `google-generative-ai` | Gemini native `generateContent` | Not supported |

The Bridge is a small compatibility layer on top of the native implementation.
It does not replace DSH/Pi's general LLM adapter.

### OpenAI Responses request flow

1. DSH/Pi builds the normal request from the conversation, reasoning settings,
   local tools, and model profile.
2. The Bridge removes `max_output_tokens`, which is rejected by some
   third-party gateways.
3. When hosted search is enabled, the Bridge appends the configured Responses
   hosted tool, defaults to `web_search`, sets `tool_choice` to `auto` when it
   is not already set, and requests search sources.
4. The local Function Tool named `web_search` is removed only on this hosted
   search path. Other local tools are preserved.
5. Pi continues to parse messages, reasoning, ordinary tool calls, usage,
   errors, and replay data from the Responses stream.

The Bridge does not inject a web-search system prompt and does not rewrite
`max_tokens`, `text`, `reasoning`, `parallel_tool_calls`, `client_metadata`, or
other native request fields.

When hosted search is disabled, the route uses Pi's native
`openAIResponsesApi()` path directly.

### Gemini request flow

Routes using `google-generative-ai` call Pi's native Gemini adapter and preserve
the Gemini request body and `generateContent` stream behavior. OpenAI Responses
hosted tool objects are rejected on this route instead of being sent to Gemini.

### Settings and credentials

The Client bundle adds a separate `Third-party models` section. Providers saved
there are written only to `llm-openai-responses-bridge`; they are not inserted
into DSH's native Models page or native protocol dropdown.

The section supports:

- protocol selection between `OpenAI Responses (Bridge)` and
  `Google Generative AI`;
- adding, editing, and deleting Bridge providers;
- manual model entry and OpenAI-compatible model discovery;
- a write-only API-key field;
- hosted `web_search` enable/disable control for OpenAI Responses routes;
- preserving an existing credential when an API-key field is left blank.

The form writes the API key through `credentials.set`. YAML uses `apiKeyEnv` as
the DSH credential reference; it is not a secret value and should not contain
the key itself.

### Hosted search events

Responses hosted search events are normalized into the Bridge session event
family:

```text
bridge/hosted-web-search/start
bridge/hosted-web-search/update
bridge/hosted-web-search/end
```

The Client bundle registers a conversation node for these events. It renders a
search card with status, query text, safe HTTP(S) sources, citations, and errors.
The card is not a local DSH `tool/call`, and the Bridge never fetches or executes
source URLs.

### Sandbox schema compatibility

The plugin also registers the adapted `dsh-pwsh-sandbox-schem` behavior. When
the effective session mode is `danger-full-access`, it makes a copy of the
model-facing `pwsh`, `bash`, `edit`, and `write` schemas and removes only
`sandbox_permissions` and `justification` from those copies.

Restricted sessions keep the native escalation schema. This changes the schema
shown to the model only; it does not change DSH's sandbox policy, approval
policy, executor, or filesystem authority.

## Requirements

- DeepSeek Harness APIs from `0.1.1-rc.2`;
- an upstream service implementing either OpenAI Responses or native Gemini
  `generateContent`;
- Node.js `^22.19.0` or `>=24.0.0` and pnpm `>=10` when building from source.

For OpenAI Responses routes, `baseURL` must be an absolute HTTP(S) URL without
the `/responses` suffix. For example, use `https://api.example.com/v1`; the
native client appends `/responses`.

For Gemini routes, include the native API version path, such as
`https://generativelanguage.googleapis.com/v1beta`.

## Install

Install a reviewed GitHub tag or commit SHA so the DSH plugin version is
reproducible:

```powershell
dsh plugin --profile web add 'github:DaoCaoRenH/dsh-openai-responses-bridge#<commit-sha>'
```

For local development:

```powershell
git clone https://github.com/DaoCaoRenH/dsh-openai-responses-bridge.git
Set-Location dsh-openai-responses-bridge
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add (Get-Location).Path
```

Remove the plugin with:

```powershell
dsh plugin --profile web remove dsh-openai-responses-bridge
```

## Configure a provider

The settings namespace is `llm-openai-responses-bridge`.

### OpenAI Responses provider

Add this shape to `$DSH_HOME/settings.yaml`, or use the `Third-party models`
settings section:

```yaml
llm-openai-responses-bridge:
  providers:
    gateway:
      api: openai-responses
      apiKeyEnv: THIRD_PARTY_OPENAI_API_KEY
      displayName: Third-party Responses
      baseURL: https://api.example.com/v1
      models:
        - id: provider-model-id
          name: Provider model
          input: [text]
          contextWindow: 131072
          maxTokens: 32768
          reasoningEfforts:
            off: null
            low: low
            medium: medium
            high: high
            xhigh: xhigh
            max: max
      hostedTools:
        enabled: true
        definitions:
          - type: web_search
        toolChoice: auto
```

New providers created in the settings card have hosted tools disabled by
default. Set `hostedTools.enabled` to `true` only when the upstream service
supports Responses hosted tools and remote search is needed.

### Native Gemini provider

The same namespace can contain a native Gemini route:

```yaml
    google:
      api: google-generative-ai
      apiKeyEnv: GEMINI_API_KEY
      displayName: Gemini 3.6 Flash
      baseURL: https://generativelanguage.googleapis.com/v1beta
      reasoning: off
      models:
        - id: gemini-3.6-flash
          name: gemini-3.6-flash
          input: [text, image]
          maxTokens: 8192
          reasoningEfforts:
            off: null
            low: low
            medium: medium
            high: high
```

Gemini 3 Flash uses native `MINIMAL`, `LOW`, `MEDIUM`, and `HIGH` thinking
levels. `xhigh` and `max` are not declared in the Gemini example. Actual model
and thinking support depends on the configured upstream service.

The default reasoning map for Bridge models is:

```yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

Keep API keys in DSH credentials or the launching environment. Do not put a
key in `settings.yaml`, `.credentials.yaml`, source files, or static headers.

## Hosted tools and limits

| Tool | Behavior |
| --- | --- |
| `web_search`, `web_search_preview` | Supported for OpenAI Responses hosted passthrough and search-card events. |
| `file_search` | Requires non-empty `vector_store_ids`; the remote endpoint must support it. |
| `code_interpreter` | Remote passthrough only; no local DSH executor or continuation. |
| `mcp`, `tool_search`, `namespace` | Remote definitions may pass through; secrets in definitions are rejected. |
| `image_generation` | Refused in the current DSH `rc.2` integration because no safe image output backend is available. |
| `computer`, `local_shell`, `shell`, `apply_patch`, `custom` | Refused because there is no DSH executor and approval continuation for these remote tools. |

Hosted calls are remote calls. A remote code interpreter or MCP service does not
receive local filesystem, shell, or DSH approval authority.

The plugin does not implement OAuth login/refresh or provider-specific token
exchange. Use a separate authentication strategy when the upstream service
requires one.

## Update and troubleshooting

Update a Git-installed plugin with:

```powershell
dsh plugin --profile web update
```

Common configuration errors:

- `MISSING_CREDENTIAL`: the `apiKeyEnv` credential reference has no value;
- invalid `baseURL`: use an absolute HTTP(S) URL;
- no models: every provider route must declare at least one model;
- hosted validation error: check tool-specific fields such as
  `vector_store_ids`, and keep MCP secrets in DSH credentials;
- HTTP/SSE error: verify that the selected upstream implements the expected
  `/responses` or Gemini `generateContent` endpoint and stream format.
