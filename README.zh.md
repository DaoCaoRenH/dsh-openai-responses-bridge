# dsh-openai-responses-bridge

面向 DeepSeek Harness 的独立插件，用于接入第三方 OpenAI Responses 服务和
Gemini 原生 Generative AI 服务。当前版本只适配 DeepSeek Harness
`0.1.2-alpha.1`。

DSH 插件 ID 为 `llm-openai-responses-bridge`。插件通过 DSH 的插件接口工作，
不修改 DeepSeek Harness 宿主源码。

[English](README.md) | [安全说明](SECURITY.md) | [许可证](LICENSE)

## 功能

- 在不修改 DSH 原生提供方列表的情况下添加第三方 OpenAI Responses 模型；
- 在同一个 Bridge 设置分区中添加 Gemini 原生模型；
- 复用 DSH/Pi 原生的消息转换、推理、工具转换、replay、usage 和流错误处理；
- 可选透传远端 Responses `web_search`，并在 DSH 对话中显示搜索状态、查询、
  citation、来源和错误；
- 从 OpenAI 兼容的 `/models` 接口获取模型，并在保存前选择模型；
- 普通模式与 Code Mode/PTC 共用同一个 provider，不暴露额外的 provider 专用搜索工具；
- 通过 DSH credentials 保存 API 密钥，配置文件中不保存密钥值；
- 内置 `dsh-pwsh-sandbox-schem` 兼容行为，不需要再安装第二个 shim 插件；
- provider 配置支持热加载，不需要修改 DSH 宿主源码。

## 实现方式

### 协议路由

`llm-openai-responses-bridge` namespace 中的每个 route 使用一种 Pi 原生协议：

| Route 协议 | 上游请求 | OpenAI hosted tools |
| --- | --- | --- |
| `openai-responses` | OpenAI Responses `POST /responses` | 开启后支持 |
| `google-generative-ai` | Gemini 原生 `generateContent` | 不支持 |

Bridge 是建立在 DSH/Pi 原生实现之上的小型兼容层，不替换 DSH/Pi 的通用 LLM
适配器。

### OpenAI Responses 请求流程

1. DSH/Pi 根据会话、推理设置、本地工具和模型配置构造原生请求；
2. Bridge 删除部分第三方网关不接受的 `max_output_tokens`；
3. 开启 hosted search 后，Bridge 追加配置的 Responses hosted tool，默认是
   `web_search`；如果请求没有指定 `tool_choice`，则设为 `auto`，并请求搜索来源；
4. 仅在 hosted search 路径中移除名为 `web_search` 的本地 Function Tool，其他
   本地工具保持不变；
5. 消息、推理、普通工具调用、usage、错误和 replay 仍由 Pi 解析 Responses 流。

Bridge 不注入联网搜索系统提示词，也不修改 `max_tokens`、`text`、`reasoning`、
`parallel_tool_calls`、`client_metadata` 或其它原生字段。

关闭 hosted search 时，route 直接使用 Pi 原生 `openAIResponsesApi()`。

### Code Mode / PTC 流程

Code Mode 只向模型暴露 DSH 已有的 `run_code` transport。Bridge 不注册新的
`web_search_openai` 工具，也不修改 Code Mode 实现。在外层 `run_code` 调用活动期间，
Bridge 观察嵌套的 `tools.web_search()` dispatch；当当前 route 是已启用 hosted search
的 Bridge OpenAI Responses provider 时，发送一个最小的 Responses hosted 搜索请求。
结果会转换为 DSH 原生 `web_search` 值（`content`、`sources`、`truncated`），所以
Code Mode SDK 的调用契约保持不变。

关闭 hosted search，或当前 route 是原生 provider、Google provider 或其它 provider 时，
嵌套 dispatch 会继续调用 DSH 的 `next()` 原生路径。这样 `native`、`code` 和 `both`
三种模式共用同一个 provider 设置，不会混用 provider 专用工具名。

### Gemini 请求流程

`google-generative-ai` route 直接使用 Pi 原生 Gemini 适配器，保留 Gemini 原生
请求体和 `generateContent` stream 行为。插件会拒绝将 OpenAI Responses hosted
tool 对象发送给 Gemini。

### 设置界面与凭据

Client bundle 会增加独立的“第三方模型”设置分区。该分区保存的 provider 只写入
`llm-openai-responses-bridge`，不会加入 DSH 原生“模型”页面，也不会修改原生
API 协议下拉框。

设置分区支持：

- 在 `OpenAI Responses（Bridge）` 和 `Google Generative AI` 之间选择协议；
- 添加、编辑和删除 Bridge provider；
- 手动填写模型，或从 OpenAI 兼容接口获取模型；
- 使用只写入的 API 密钥输入框；
- 为 OpenAI Responses route 启用或关闭 hosted `web_search`；
- 编辑时 API 密钥留空，保留已有 credential。

表单通过 `credentials.set` 写入 API 密钥。YAML 中的 `apiKeyEnv` 是 DSH
credential reference，不是密钥值，不能直接填写 API 密钥。

模型获取是编辑器发起的一次性请求。对于 OpenAI Responses provider，Bridge 会使用
草稿中的 API 地址和密钥发送 `GET {baseURL}/models`，只返回候选模型，不写入设置。
Google provider 不通过 Bridge 探测 Gemini 模型目录，需要手动填写模型。

### Hosted 搜索事件

Responses hosted search 事件会被规范化为 Bridge Session 事件：

```text
bridge/hosted-web-search/start
bridge/hosted-web-search/update
bridge/hosted-web-search/end
```

Client bundle 为这些事件注册 Conversation Node，显示包含状态、查询文本、安全的
HTTP(S) 来源、citation 和错误信息的搜索卡片。搜索卡片不是本地 DSH
`tool/call`，Bridge 也不会抓取或执行来源 URL。

### Sandbox schema 兼容

插件同时注册适配后的 `dsh-pwsh-sandbox-schem` 行为。当会话有效模式为
`danger-full-access` 时，插件复制面向模型的 `pwsh`、`bash`、`edit`、`write`
schema，并只从副本中移除 `sandbox_permissions` 和 `justification`。

受限会话仍使用 DSH 原生提权 schema。这只改变模型看到的 schema，不改变 DSH 的
沙箱策略、审批策略、executor 或文件系统权限。

## 前置条件

- DeepSeek Harness `0.1.2-alpha.1` 相关 API；
- 上游服务实现 OpenAI Responses 或 Gemini 原生 `generateContent`；
- 从源码构建时需要 Node.js `^22.19.0` 或 `>=24.0.0`，以及 pnpm `>=10`。

OpenAI Responses route 的 `baseURL` 必须是绝对 HTTP(S) 地址，不能包含
`/responses`。例如填写 `https://api.example.com/v1`，原生 client 会自动追加
`/responses`。

Gemini route 应填写包含原生版本路径的地址，例如
`https://generativelanguage.googleapis.com/v1beta`。

## 安装

建议使用经过审查的 GitHub tag 或 commit SHA 安装，以固定插件版本：

```powershell
dsh plugin --profile web add 'github:DaoCaoRenH/dsh-openai-responses-bridge#<commit-sha>'
```

针对目标 DSH 版本进行源码开发时，请将插件放入匹配版本 DSH checkout
中的临时 workspace package 目录：

```powershell
git clone --branch dsh-v0.1.2-alpha.1 https://github.com/deepseek-ai/deepseek-harness.git
New-Item -ItemType Directory -Force deepseek-harness/packages/bridge | Out-Null
git clone https://github.com/DaoCaoRenH/dsh-openai-responses-bridge.git deepseek-harness/packages/bridge/dsh-openai-responses-bridge
Set-Location deepseek-harness
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm run build:lib
Set-Location packages/bridge/dsh-openai-responses-bridge
pnpm run check
pnpm run build
```

源码只适配 DSH `0.1.2-alpha.1`。由于这是预发布版本，从源码构建时需要使用
registry 中的匹配 DSH 包，或使用匹配版本的 DSH 构建产物。本项目不支持旧的
`0.1.1-rc.2` API。

正常使用时，建议直接通过 DSH 插件管理器安装经过审查的 GitHub ref，
不需要单独安装尚未发布的 DSH peer 包。

卸载插件：

```powershell
dsh plugin --profile web remove dsh-openai-responses-bridge
```

## 配置 provider

配置 namespace 为 `llm-openai-responses-bridge`。

### OpenAI Responses provider

可以在 `$DSH_HOME/settings.yaml` 中加入以下配置，也可以使用“第三方模型”设置
分区：

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

设置界面新建 provider 时默认关闭 hosted tools。只有上游支持 Responses hosted
tools 且确实需要远端搜索时，才设置 `hostedTools.enabled: true`。

### Gemini 原生 provider

同一个 namespace 可以配置 Gemini 原生 route：

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

Gemini 3 Flash 使用原生 `MINIMAL`、`LOW`、`MEDIUM`、`HIGH` 推理级别。示例中
不声明 `xhigh` 和 `max`；实际模型和推理能力取决于配置的上游服务。

Bridge 模型默认推理映射如下：

```yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

API 密钥应保存在 DSH credentials 或启动环境中。不要把密钥放入
`settings.yaml`、`.credentials.yaml`、源代码或静态 headers。

## Hosted tools 与限制

| Tool | 行为 |
| --- | --- |
| `web_search`、`web_search_preview` | 支持 OpenAI Responses hosted 透传，并生成搜索卡片事件。 |
| `web_fetch` | 本插件不注册该工具；搜索来源只作为元数据展示，不会在本地抓取。 |
| `file_search` | 必须提供非空 `vector_store_ids`，且上游需要支持该工具。 |
| `code_interpreter` | 仅远端透传，不提供本地 DSH executor 或 continuation。 |
| `mcp`、`tool_search`、`namespace` | 可以透传远端 definition，但会拒绝 definition 中的 secret。 |
| `image_generation` | DSH `0.1.2-alpha.1` 没有安全的图片输出 backend，因此拒绝。 |
| `computer`、`local_shell`、`shell`、`apply_patch`、`custom` | 没有 DSH executor 和审批 continuation，因此拒绝。 |

Hosted call 永远是远端调用。远端 code interpreter 或 MCP 服务不会获得本地文件系统、
shell 或 DSH 审批权限。

插件不实现 OAuth 登录/刷新或服务商专用 token exchange；需要时使用独立的认证策略。

## 更新与排查

更新 Git 安装的插件：

```powershell
dsh plugin --profile web update
```

常见配置错误：

- `MISSING_CREDENTIAL`：`apiKeyEnv` 指向的 credential 没有值；
- `baseURL` 无效：使用绝对 HTTP(S) 地址；
- 没有模型：每个 provider route 至少声明一个 model；
- hosted 校验错误：检查 `vector_store_ids` 等工具专用字段，并把 MCP secret
  放到 DSH credentials；
- HTTP/SSE 错误：确认上游实现了对应的 `/responses` 或 Gemini
  `generateContent` endpoint 和 stream 格式。
