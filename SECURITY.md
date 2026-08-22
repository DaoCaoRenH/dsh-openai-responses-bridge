# Security Policy

## Reporting a vulnerability

Please do not open a public issue containing API keys, credential files, session
transcripts, or exploit details. If GitHub private vulnerability reporting is
enabled for this repository, use that channel. Otherwise contact `@DaoCaoRenH`
through the GitHub profile at https://github.com/DaoCaoRenH with a minimal
reproduction and the affected commit or version. Do not report vulnerabilities
through public issues.

## Secret handling

Provider keys belong in DSH credentials or the launching environment. Do not put
keys in `settings.yaml`, source files, tests, screenshots, issue reports, or
pull requests. If a secret is committed accidentally, revoke it first and then
report the affected commit privately; deleting the file alone does not remove it
from Git history.
