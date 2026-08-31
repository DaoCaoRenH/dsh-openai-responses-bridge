# Contributing

Thanks for helping improve `dsh-openai-responses-bridge`.

## Development setup

- Node.js `^22.19.0` or `>=24.0.0`;
- pnpm `>=10`;
- a DeepSeek Harness `0.1.2-alpha.2` development environment for integration work.

The plugin targets the DSH `0.1.2-alpha.2` prerelease, whose packages may not be
available from a public registry yet. For integration development, check out
the matching DSH tag and place this repository under its workspace:

~~~powershell
git clone --branch dsh-v0.1.2-alpha.2 https://github.com/deepseek-ai/deepseek-harness.git
New-Item -ItemType Directory -Force deepseek-harness/packages/bridge | Out-Null
git clone https://github.com/DaoCaoRenH/dsh-openai-responses-bridge.git deepseek-harness/packages/bridge/dsh-openai-responses-bridge
Set-Location deepseek-harness
pnpm install --no-frozen-lockfile
pnpm run build:lib
Set-Location packages/bridge/dsh-openai-responses-bridge
pnpm run check
pnpm run build
~~~

CI uses the same workspace layout. Do not copy DSH source packages into this
repository or commit the DSH workspace's generated files here.

## Required checks

Run these before opening a pull request:

~~~powershell
pnpm run check
pnpm run build
pnpm pack --dry-run
git diff --check
git diff --exit-code -- lib
~~~

The checked-in `lib/` directory is the installable DSH bundle. If source code
changes affect the bundle, include the regenerated runtime and type output in
the same change. Generated source maps, local DSH state, credentials, logs, and
dependency directories must not be committed. CI also verifies that rebuilding
the committed bundle leaves `lib/` unchanged.

## Scope and review expectations

- Keep the host source tree unchanged; integration belongs in this plugin.
- Preserve DSH/Pi native message, stream, reasoning, usage, and replay behavior
  unless a change explicitly documents a protocol boundary.
- Keep OpenAI Responses and Gemini native behavior separate.
- Add or update tests for protocol conversion, event handling, settings writes,
  and user-visible UI changes.
- Update both `README.md` and `README.zh.md` when configuration or installation
  behavior changes.
- Never include API keys, credential files, private session data, or machine-
  specific absolute paths in commits.

## Pull requests

Describe the behavior change, the affected protocol or UI surface, validation
commands, and any compatibility impact. Keep commits focused and avoid mixing
generated or unrelated cleanup with functional changes.
