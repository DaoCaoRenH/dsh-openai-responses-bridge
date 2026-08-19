# dsh-openai-responses-bridge

dsh-openai-responses-bridge is an independent DeepSeek Harness bundle for
Google Generative AI and third-party services exposing an OpenAI
Responses-compatible endpoint. Its DSH plugin identity is
llm-openai-responses-bridge.

It provides configurable provider routes and models, native Pi protocol
dispatch, the fixed Bridge request delta for OpenAI Responses routes, optional
remote web_search passthrough, DSH credential references, and hot route
replacement.

This is a bundle, not a DeepSeek Harness fork. It integrates through DSH's
plugin surfaces and does not require changes to the host source tree. It does
not load the Pi Coding Agent extension. The model-facing sandbox-schema
compatibility logic is included in this bundle, so Bridge installation is
self-contained.

The repository is prepared for public distribution. It contains source code and
committed `lib/` output, but no API keys, credential files, or runtime user data.
`lib/` is committed because a DSH Git plugin installation must be able to load
the package without running a local build first. Generated browser source maps
are intentionally excluded from the repository and package.

## Requirements

- DeepSeek Harness 0.1.0-rc.7 APIs used by this package;
- Node.js ^22.19.0 or >=24.0.0;
- pnpm >=10;
- either an OpenAI Responses-compatible service accepting POST .../responses and
  Responses SSE events, or a Gemini-compatible generateContent endpoint.

For `api: openai-responses`, `baseURL` follows DSH/Pi's native OpenAI client
convention, for example `https://api.example.com/v1`; the native client appends
`/responses`. Do not include `/responses` in `baseURL`. For
`api: google-generative-ai`, use the Gemini native base URL including its version
path, such as `https://generativelanguage.googleapis.com/v1beta`; Pi calls the
native `generateContent` stream. Both routes retain native Pi/DSH message,
reasoning, replay, usage, and stream-error behavior.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and
[SECURITY.md](SECURITY.md) for secret-handling and vulnerability-reporting
guidance.

## Install on Windows

Clone the repository and use an isolated DSH home for the first install:

~~~powershell
git clone https://github.com/DaoCaoRenH/dsh-openai-responses-bridge.git
Set-Location dsh-openai-responses-bridge
$env:DSH_HOME = Join-Path $PWD '.dsh-user-test'
dsh plugin --profile web add (Get-Location).Path
dsh plugin --profile web why dsh-openai-responses-bridge
dsh --profile web --dump-config
~~~

Omit DSH_HOME to use the normal DSH home. The Bridge bundle already includes
the sandbox-schema compatibility behavior; no second shim package is needed.
To remove the whole bundle:

~~~powershell
dsh plugin --profile web remove dsh-openai-responses-bridge
~~~

For a release installation, use a Git specification pinned to a commit SHA. A
reviewed local tarball is also supported:

~~~powershell
dsh plugin --profile web add 'github:DaoCaoRenH/dsh-openai-responses-bridge#<commit-sha>'
dsh plugin --profile web add '.\dsh-openai-responses-bridge-0.1.0.tgz'
~~~

Keep the commit pin when updating the plugin so deployments remain reproducible.

## Configure a route

The settings namespace is llm-openai-responses-bridge. Add this shape to
$DSH_HOME/settings.yaml:

~~~yaml
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
~~~

The same namespace can declare a native Gemini route. Hosted OpenAI Responses
tools are intentionally unavailable on this route:

~~~yaml
    google:
      api: google-generative-ai
      apiKeyEnv: DSH_BRIDGE_CODEX_API_KEY
      displayName: Gemini 3.6 Flash
      baseURL: https://api.nodus.sbs/v1beta
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
~~~

The current Pi Gemini adapter treats `gemini-3.*-flash` as a Gemini 3 Flash
model. Its native thinking levels are `MINIMAL`, `LOW`, `MEDIUM`, and `HIGH`.
For this route, `off` uses the lowest `MINIMAL` level while hiding thought
output because Gemini 3 Flash does not provide a full thinking-off mode.
`xhigh` and `max` are not native Gemini levels and are not declared in the
Google example above. Actual support still depends on the configured upstream
service implementing the model and these Gemini fields.

apiKeyEnv is a credential reference, not a secret. Resolve it through DSH
credentials or the launching environment. Do not put the key in settings.yaml,
commit .credentials.yaml, or put secret headers in headers. Static headers are
for non-sensitive deployment metadata. OpenAI Responses routes use the native
Bearer API-key path; Google routes use Pi's native Google API-key path. This
field is primarily for advanced YAML configuration; the settings card derives
an internal credential reference for new routes.

An empty providers map is intentionally dormant. A valid route becomes an LLM
provider id; its models are the ids listed under that route. Bridge routes are
deliberately not registered in DSH's configurable-provider directory, so the
native Models page does not render them. The standalone Bridge section reads
this namespace and renders them there. Settings changes are hot-reloaded. An
invalid topology update leaves the previous routes active.

## Web settings card

With the Client bundle installed, the settings panel exposes an independent
“Third-party models” section. Its provider form, collapsed model rows, advanced
fields, and footer follow DSH's native custom-provider design, while the write
target remains `llm-openai-responses-bridge`; the native Models page and API
protocol dropdown are not changed. The Bridge card's API protocol selector
offers `Google Generative AI` and `OpenAI Responses (Bridge)`. Bridge routes are
intentionally kept out of the native configurable-provider directory, so a
provider created here appears only in this section.

The model directory can be entered by hand or, for OpenAI Responses routes,
fetched from the current endpoint's `/models` path. Results open in a candidate
picker and are added to the draft only after the user selects them. Google
routes currently require manual model entry because the Bridge discovery probe
is OpenAI-shaped. Discovery uses the API key currently typed into the form; the
Bridge Host never stores or returns that key. The new provider form has one
write-only API-key field; saving derives a route-specific credential reference
and writes the key through `credentials.set`. Existing YAML routes can still
use their configured `apiKeyEnv` reference.

Each Bridge route summary has `Edit` and `Delete` actions. Editing keeps the route
id and only updates fields owned by this card; leaving the API-key field blank keeps
the existing credential reference, while a new value replaces that credential.
Delete requires confirmation, unsets the route from the Bridge namespace, and removes
the writable credential generated by this card when applicable. External or YAML-owned
credential references are kept.

The settings card does not expose a reasoning-effort selector. New manually added
models and models adopted from discovery receive this fixed Bridge mapping; an
existing explicit model mapping is preserved when editing:

~~~yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
~~~

Disable the default hosted search while preserving local Function Tools with:

~~~yaml
      hostedTools:
        enabled: false
~~~

## OpenAI Responses Bridge request delta

Bridge mode is fixed and is not exposed as a request-compatibility selector. The
Bridge applies only these changes on top of DSH/Pi's native Responses request:

- removes `max_output_tokens`;
- when `hostedTools.enabled` is true, appends the configured Responses hosted
  tool definitions (by default `web_search`) and the source include requested
  by that tool;
- when hosted web search is enabled, removes only the local Function Tool whose
  name is `web_search`, leaving other local tools unchanged;
- it does not inject a web-search system prompt.

For an OpenAI Responses route with hosted search disabled, the route uses Pi's native
`openAIResponsesApi()`. With hosted search enabled, the Bridge owns only a thin
Responses HTTP/SSE wrapper so it can tee raw events: Pi's public
`convertResponsesMessages()`, `convertResponsesTools()`, and
`processResponsesStream()` still own message conversion, ordinary tool parsing,
reasoning, usage, errors, and replay. `max_tokens`, `client_metadata`,
`parallel_tool_calls`, `text`, `reasoning`, and all other native fields are not
rewritten by the Bridge.

Google routes do not pass through this delta layer. They call Pi's native
`googleGenerativeAIApi()` implementation, preserve Gemini's native request body,
and reject `hostedTools.enabled` so an OpenAI Responses tool object cannot be
sent to Gemini.

## Embedded sandbox schema compatibility

Bridge also registers the adapted `dsh-pwsh-sandbox-schem` behavior while its
host bundle is loading. When a session's effective sandbox mode is
`danger-full-access`, it removes only `sandbox_permissions` and `justification`
from the model-facing `pwsh`, `bash`, `edit`, and `write` schemas. Restricted
sessions keep the native escalation path unchanged.

This is a schema-only, copy-on-write filter. It does not change DSH's sandbox
policy, approval policy, executor, or filesystem authority. The compatibility
reference is not a runtime dependency.

## Tools and web search

DSH/Pi Function Tools are converted by native Pi. When the Bridge toggle is
enabled on an OpenAI Responses route, raw Responses hosted definitions are
appended after that native payload. With the default settings, the request includes `web_search`,
`tool_choice: auto`, and `include: ["web_search_call.action.sources"]`.
The model sees a real hosted tool definition; the Bridge does not rely on a
system-prompt instruction to simulate one. When hosted search is disabled, the
local `web_search` Function Tool is left on the native path.

Google Generative AI routes use Pi's native Gemini function-tool conversion.
They do not receive the Bridge hosted `web_search` definition; use a native
Gemini-capable tool path or enter a separate OpenAI Responses route when hosted
search is required.

| Tool type | V1 behavior |
| --- | --- |
| web_search, web_search_preview | Supported remote passthrough; Pi owns text/reasoning/usage/replay parsing and Bridge observes hosted SSE events for the search card. |
| file_search | Requires non-empty vector_store_ids; endpoint support needs a separate probe. |
| code_interpreter | Remote protocol passthrough only; no local DSH executor or continuation. |
| mcp, tool_search, namespace, raw function | Definitions may pass through; endpoint semantics remain remote. MCP secrets in definitions are rejected. |
| image_generation | Always refused in rc.7 because no verified DSH-safe image output backend exists. |
| computer, computer_use_preview, local_shell, shell, apply_patch, custom | Refused because no DSH executor, approval continuation, or sandbox integration exists. |

A hosted call is never local DSH execution. A remote code interpreter or MCP
service does not obtain local filesystem or shell authority.

Hosted search lifecycle facts are normalized into the Bridge session event family
`bridge/hosted-web-search/start|update|end`. The Client bundle registers a
separate `ConversationNodeDefinition` and renders a `Web Search Openai` card
with status, query, safe `http`/`https` sources, citations, and errors. It is not
a DSH `tool/call`, does not run a local executor, and does not enter the native
tool-call UI. The Bridge does not fetch or execute source URLs. The Host must
load Bridge before restoring sessions so its event types are registered in the
current DSH session catalog.

## Image and cost boundary

Image generation is intentionally unavailable in this rc.7 bundle. Explicit
imageGeneration.enabled: true is rejected instead of writing base64 data to an
arbitrary path outside a verified DSH attachment backend.

Hosted search, file search, code execution, MCP, and image services can cause
additional charges or server-side state. Review provider pricing and retention,
and enable only the tool types needed by the endpoint. The default web_search
can be disabled.

## Update and troubleshooting

After changing the checkout:

~~~powershell
Set-Location '<path-to>\dsh-openai-responses-bridge'
pnpm run build
dsh plugin --profile web update
dsh --profile web --dump-config
~~~

Useful checks:

~~~powershell
dsh plugin --profile web why dsh-openai-responses-bridge
~~~

MISSING_CREDENTIAL means the apiKeyEnv reference has no value.
baseURL must be an absolute HTTP(S) URL. A route must declare at least one
model. Hosted validation errors usually mean an executor-dependent tool was
selected, file_search lacks vector_store_ids, or an MCP secret was placed in a
raw definition. HTTP/SSE errors require the selected protocol's endpoint: POST
/responses and Responses-compatible events for OpenAI routes, or Gemini
generateContent SSE for Google routes.

V1 does not implement OAuth login/refresh or provider-specific token exchange;
use a separate named auth strategy for such a service.

## Development checks

From the repository root:

~~~powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
~~~

## Repository publication checklist

Before opening a pull request or creating a public release:

~~~powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm pack --dry-run
git diff --check
git status --short
~~~

Do not stage `node_modules`, `.env` files, credential files, local tarballs,
runtime logs, or local DSH state. Tag reviewed releases and install the exact
tag or commit SHA from GitHub.
