# dsh-openai-responses-bridge

dsh-openai-responses-bridge 是面向 Google Generative AI 和第三方 OpenAI
Responses 兼容服务的 DeepSeek Harness 独立 bundle，DSH 插件身份为
llm-openai-responses-bridge。

它提供：

- 可配置的 provider route 和 model directory；
- OpenAI Responses route 的固定 Bridge 请求差异层；
- 按协议复用 DSH/Pi 原生 Gemini 或 Responses 消息、流、reasoning 和 replay 行为；
- 可选的远端 web_search 透传；
- DSH credentials 引用和 settings 热加载；
- 不修改 DSH 源码的独立 bundle 接入。

它不是 DeepSeek Harness 源码 fork，通过 DSH 的插件接口接入，不要求修改宿主
源码，也不会加载 Pi Coding Agent extension。sandbox schema 兼容逻辑已经内置
在本 bundle 中，安装 Bridge 即可使用，不需要再安装第二个 shim 包。

仓库按公开发布整理。仓库包含源代码和提交后的 `lib/` 构建产物，不包含 API
密钥、credential 文件或运行时用户数据。提交 `lib/` 是为了让 DSH 通过 Git
插件安装时无需先在本地重新构建即可加载 bundle。浏览器 bundle 的生成 source
map 已明确排除，不会进入仓库和发布包。

## 前置条件

- DeepSeek Harness 0.1.0-rc.7 相关公开 API；
- Node.js ^22.19.0 或 >=24.0.0；
- pnpm >=10；
- 服务支持 OpenAI Responses 的 POST .../responses 和 Responses SSE，或
  Gemini 原生 generateContent 接口。

`api: openai-responses` 时，baseURL 遵循 DSH/Pi 原生 OpenAI client 约定，例如
`https://api.example.com/v1`；原生 client 会追加 `/responses`，因此
`baseURL` 不要包含 `/responses`。`api: google-generative-ai` 时，填写包含
版本路径的 Gemini 原生 baseURL，例如
`https://generativelanguage.googleapis.com/v1beta`，Pi 会调用原生
`generateContent` stream。两种 route 的消息、stream、reasoning、replay、usage
和流错误行为都复用 DSH/Pi 原生实现。

开发检查见 [CONTRIBUTING.md](CONTRIBUTING.md)，密钥处理和漏洞报告见
[SECURITY.md](SECURITY.md)。

## Windows 安装

先克隆仓库，再用隔离的 DSH home 测试：

~~~powershell
git clone https://github.com/DaoCaoRenH/dsh-openai-responses-bridge.git
Set-Location dsh-openai-responses-bridge
$env:DSH_HOME = Join-Path $PWD '.dsh-user-test'
dsh plugin --profile web add (Get-Location).Path
dsh plugin --profile web why dsh-openai-responses-bridge
dsh --profile web --dump-config
~~~

DSH_HOME 可省略；省略后使用正常 DSH home。Bridge bundle 已经包含
sandbox schema 兼容行为，不需要单独安装 shim。卸载整个 bundle：

~~~powershell
dsh plugin --profile web remove dsh-openai-responses-bridge
~~~

发布安装建议使用固定 commit SHA 的 Git 规格；也可以使用经过审查的本地
tarball：

~~~powershell
dsh plugin --profile web add 'github:DaoCaoRenH/dsh-openai-responses-bridge#<commit-sha>'
dsh plugin --profile web add '.\dsh-openai-responses-bridge-0.1.0.tgz'
~~~

更新插件时继续固定 commit，保证部署可复现。

## 配置 provider route

Bridge settings namespace 是 llm-openai-responses-bridge，在
$DSH_HOME/settings.yaml 中加入：

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

同一个 namespace 也可以声明 Gemini 原生 route。该 route 不支持 OpenAI
Responses hosted tools：

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

当前 Pi Gemini 适配器会把 `gemini-3.*-flash` 识别为 Gemini 3 Flash。它的原生
推理级别是 `MINIMAL`、`LOW`、`MEDIUM`、`HIGH`。该 route 中 `off` 会使用最低的
`MINIMAL` 级别并隐藏思考输出，因为 Gemini 3 Flash 不提供真正的完全关闭推理
模式。`xhigh` 和 `max` 不是 Gemini 原生级别，因此 Google 示例不再声明它们。
最终是否可用仍取决于配置的上游服务是否实现了该模型和这些 Gemini 字段。

apiKeyEnv 是凭据引用，不是密钥。请通过 DSH credentials 或启动环境提供
值，不要把密钥放入 settings.yaml、提交 .credentials.yaml，或把 secret
header 放入 headers。headers 只用于非敏感部署元数据；OpenAI Responses route
使用原生 Bearer API key，Google route 使用 Pi 原生 Google API key。这个字段
主要用于高级 YAML 配置；设置卡会为新 route 自动派生内部 credential reference。

providers 为空时插件保持 dormant。有效 route 会成为 LLM provider id，模型 id
就是该 route 下声明的模型。Bridge route 不注册到 DSH 原生的 configurable-provider
directory，因此不会出现在原生“模型”页面；Bridge 独立分区直接读取自己的
namespace 并只在该分区显示。settings 更新会热加载；非法的 route topology 更新
会保留旧 route。

## Web 设置卡

安装 Client bundle 后，设置面板会出现独立的“第三方模型”分区。新增
提供方表单的布局、模型行折叠、高级字段和底部操作沿用 DSH 原生自定义提供方
设计，但保存目标始终是 `llm-openai-responses-bridge`，不会修改原生模型页或
原生 API 协议下拉框。Bridge route 不会加入原生提供方目录，因此从此页面添加的
提供方只显示在“第三方模型”分区。卡片的 API 协议下拉框提供
`Google Generative AI` 和 `OpenAI Responses（Bridge）` 两项。

模型目录支持手工添加；OpenAI Responses route 还可以点击“获取可用模型”请求
当前 API 地址的 `/models`。返回结果只进入候选选择器，必须由用户勾选后才加入
表单草稿。Google route 当前不支持这个 OpenAI 形状的探测接口，需要手动填写
模型。探测使用当前表单输入的 API 密钥；Bridge Host 不保存或回传该密钥。新增
表单只显示一个 write-only 的“API 密钥”输入框，保存时为 route 自动派生
credential reference 并通过 `credentials.set` 写入 DSH credentials。如果使用已有
YAML route，Host 仍会按其 `apiKeyEnv` 读取 credential。

每个 Bridge route 摘要卡都有“编辑”和“删除”操作。编辑会保留 route ID，只更新
此卡拥有的字段；API 密钥留空表示保留当前 credential，输入新值才会替换该
credential。删除必须先确认，然后从 Bridge namespace 中移除当前 route；如果
credential 是此设置卡按 route 生成且可写的，会一并清理。外部或 YAML 配置使用的
credential reference 会保留。

设置卡不再提供推理强度选择。手动新增模型和从模型目录采纳的模型会自动写入下面
这组固定映射；编辑已有模型时保留其已经明确配置的映射：

~~~yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
  xhigh: xhigh
  max: max
~~~

只关闭默认远端搜索、保留本地 Function Tools：

~~~yaml
      hostedTools:
        enabled: false
~~~

## OpenAI Responses Bridge 请求差异层

Bridge 模式是固定行为，不在设置界面提供请求兼容模式选择。Bridge 在
DSH/Pi 原生 Responses 请求之上只做：

- 删除 `max_output_tokens`；
- `hostedTools.enabled` 为 true 时，在原生 payload 上追加配置的 Responses
  hosted tool，默认是 `web_search`，并追加该工具需要的 source include；
- hosted web search 开启时，只从远端请求中删除名为 `web_search` 的本地
  Function Tool，其他本地工具保持不变；
- 不注入联网搜索系统提示词。

OpenAI Responses route 的 hosted search 关闭时继续使用 Pi 原生
`openAIResponsesApi()`。Hosted search
开启时，Bridge 只在响应侧拥有一层薄的 Responses HTTP/SSE wrapper，用于 tee
原始事件；消息转换、普通工具解析、reasoning、usage、错误和 replay 仍调用
Pi 公开的 `convertResponsesMessages()`、`convertResponsesTools()` 和
`processResponsesStream()`。`max_tokens`、`client_metadata`、
`parallel_tool_calls`、`text`、`reasoning` 和其它原生字段都不由 Bridge 重写。

Google route 不经过这个差异层，而是直接使用 Pi 原生
`googleGenerativeAIApi()`，保留 Gemini 原生请求结构；如果配置
`hostedTools.enabled`，插件会拒绝该配置，避免把 OpenAI Responses tool 对象
发送给 Gemini。

## 内置 sandbox schema 兼容

Bridge 在 host bundle 加载时同时注册适配后的
`dsh-pwsh-sandbox-schem` 行为。当会话的有效沙箱模式是
`danger-full-access` 时，只从面向模型的 `pwsh`、`bash`、`edit`、`write`
schema 中移除 `sandbox_permissions` 和 `justification`。受限模式仍保留
DSH 原生提权路径。

这只是写时复制的 schema 过滤，不会修改 DSH 的沙箱策略、审批策略、executor
或文件系统权限。兼容参考实现不是运行时依赖。

## 工具和 web_search

DSH/Pi Function Tools 由 Pi 原生实现转换。OpenAI Responses route 开启 Bridge
设置后，Bridge 只在
原生 payload 之后追加 raw Responses hosted definition。默认设置下请求包含
`web_search`、`tool_choice: auto` 和
`include: ["web_search_call.action.sources"]`。
模型看到的是真实 hosted tool definition，Bridge 不依赖系统提示词模拟搜索。
关闭 hosted search 时，本地 `web_search` Function Tool 保持原生路径。

Google Generative AI route 使用 Pi 原生 Gemini Function Tool 转换，不会收到
Bridge hosted `web_search` 定义；需要 hosted 搜索时，应另配 OpenAI Responses
route。

| Tool type | V1 行为 |
| --- | --- |
| web_search、web_search_preview | 支持远端 hosted 透传；文本/reasoning/usage/replay 由 Pi 解析，Bridge 观察 hosted SSE 事件并生成搜索卡片。 |
| file_search | 必须有非空 vector_store_ids；需按 endpoint 单独探测。 |
| code_interpreter | 仅远端协议透传，没有本地 DSH executor/continuation。 |
| mcp、tool_search、namespace、raw function | 合法 definition 可以透传；endpoint 语义由服务方负责；MCP secret 会被拒绝。 |
| image_generation | rc.7 没有经验证的 DSH-safe 图片输出 backend，因此始终拒绝。 |
| computer、computer_use_preview、local_shell、shell、apply_patch、custom | 没有 DSH executor、审批 continuation 和 sandbox 接线，因此拒绝。 |

Hosted call 永远不是本地 DSH 执行。远端 code interpreter 或 MCP 不会获得本地
文件系统和 shell 权限。

Hosted 搜索生命周期会规范化为 Bridge Session 事件：
`bridge/hosted-web-search/start|update|end`。Client bundle 注册独立的
`ConversationNodeDefinition`，显示 `Web Search Openai` 卡片、状态、query、
安全的 `http`/`https` 来源、citation 和错误。它不是 DSH `tool/call`，不会运行
本地 executor，也不会混入原生工具卡片。Bridge 不会抓取或执行来源 URL。恢复
Session 前必须先加载 Bridge，使当前 DSH Session catalog 已注册这些事件类型。

## 图片和费用边界

本 rc.7 bundle 有意不支持图片生成。显式
imageGeneration.enabled: true 也会拒绝，因为没有经验证的 DSH-safe assistant
image output backend，不能把 base64 写入任意路径或绕过 DSH attachment/sandbox。

Hosted search、file search、代码执行、MCP 和图片服务可能产生额外费用或服务端
状态。启用前确认服务商价格和数据保留策略，只开真正需要的 tool type；不需要时
关闭默认 web_search。

## 更新与排查

修改本地 checkout 后：

~~~powershell
Set-Location '<path-to>\dsh-openai-responses-bridge'
pnpm run build
dsh plugin --profile web update
dsh --profile web --dump-config
~~~

查看安装及 bundle 层：

~~~powershell
dsh plugin --profile web why dsh-openai-responses-bridge
~~~

常见错误：

- MISSING_CREDENTIAL：apiKeyEnv 在 credentials 或启动环境中没有值；
- baseURL 必须是绝对 HTTP(S) URL；loopback HTTP 只用于本地测试；
- route 必须至少声明一个 model；
- hosted 校验错误：移除 executor-dependent tool，为 file_search 提供
  vector_store_ids，并把 MCP secret 放进 DSH credentials；
- HTTP/SSE 错误：按所选协议检查 endpoint；OpenAI route 应接受 POST
  /responses 并返回 Responses SSE，Google route 应返回 Gemini
  generateContent SSE。

V1 不实现 OAuth login/refresh 或服务商专用 token exchange；需要时另立具名
auth strategy。

## 开发验证

在仓库根目录执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack --dry-run
~~~

## 仓库发布检查

创建公开 release 或提交 PR 前执行：

~~~powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm pack --dry-run
git diff --check
git status --short
~~~

不要提交 `node_modules`、`.env` 文件、credential 文件、本地 tarball、运行日志
或本地 DSH 状态。应审查 release，再从 GitHub 安装固定 tag 或 commit SHA。

英文文档见 README.md。
