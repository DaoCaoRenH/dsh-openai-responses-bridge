# Contributing

Thanks for helping improve `dsh-openai-responses-bridge`.

## Development setup

- Node.js `^22.19.0` or `>=24.0.0`;
- pnpm `>=10`;
- a DeepSeek Harness `0.1.1-rc.2` development environment for integration work.

Install dependencies from the repository root:

~~~powershell
pnpm install --frozen-lockfile
~~~

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
