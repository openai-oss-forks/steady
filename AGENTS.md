# Agent guidance

Steady is a source-only, local SDK testing tool that validates HTTP requests
against OpenAPI specifications and generates mock responses. Read and follow
[SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and
[PROVENANCE.md](PROVENANCE.md) before changing it.

## Safe development

- Use trusted, reviewed OpenAPI specifications and synthetic data only. Keep TCP
  listeners on loopback; never expose Steady through proxies, tunnels, container
  port mappings, or shared hosts. Local Unix sockets are also supported.
- Never put real credentials, private keys, customer data, or production
  requests in fixtures, logs, issues, or pull requests. Redaction is not
  permission to use sensitive inputs: detailed validation responses remain
  visible to local callers, and logs retain schema pointers and route templates.
- Report vulnerabilities and suspected credential leaks privately using
  [SECURITY.md](SECURITY.md). Have the credential owner revoke or rotate exposed
  credentials; deleting them from a file is insufficient.
- Preserve redaction in every log format and verbosity level, session reports,
  and retained diagnostics. Preserve actual-byte body limits, read timeouts,
  response-generation budgets (including defaults and examples), streaming
  limits, and bounded diagnostic/session retention. Never disable these controls
  to make tests pass.

## Security-sensitive paths

Review the affected boundary and add focused regression tests when changing
security-sensitive behavior:

- `cmd/steady.ts`, `src/server/mod.ts`, `src/server/limits.ts`, and
  `src/server/options.ts`: CLI configuration, listener binding, request limits,
  and per-request overrides.
- `src/body-parser.ts`, `src/form-parser.ts`, `src/engine/parameter-parser.ts`,
  and `packages/openapi/`: request and specification parsing.
- `src/logging/`, `src/diagnostics/collector.ts`, and `src/session/`: redaction,
  diagnostic retention, and local control/report endpoints.
- `src/server/response-generator.ts`, `src/streaming.ts`, and
  `packages/json-schema/`: generated output, examples, and resource budgets.
- `deno.json`, `deno.lock`, package `deno.json` files, `scripts/`, and
  `.github/workflows/`: dependencies, execution permissions, and automation.

Existing security regressions include `src/server/security-regressions.test.ts`,
`src/server/limits.test.ts`, `src/logging/redact.test.ts`,
`src/streaming-limits.test.ts`, and
`packages/json-schema/generation-limits.test.ts`. Keep `packages/` independent
of `src/`; `scripts/check-boundaries.ts` enforces this boundary.

## Dependencies and automation

Follow these mandatory policies:

- [Dependency updates](CONTRIBUTING.md#dependency-updates): exact pins, frozen
  lockfile, 14-day maturity/provenance review, and reviewed Dependabot PRs
  without auto-merge. Age exceptions require the explicitly approved, scoped,
  temporary [urgent security process](CONTRIBUTING.md#urgent-security-updates).
- [PROVENANCE.md](PROVENANCE.md): pinned source/license/attribution records for
  dependencies and imports; no vendor corpora or unreviewed assets.
- [CI rules](CONTRIBUTING.md#continuous-integration): runner, permission,
  credential, action-pin, Deno-checksum, and frozen-install controls; no
  privileged PR execution.
- Publishing, release automation, and third-party SDK integration remain
  disabled pending separate approval. Preserve managed hooks/configuration,
  required reviews, secret scanning, and push protection; never bypass them.
- [Security scanning](CONTRIBUTING.md#security-scanning): explicit JS/TS and
  Actions CodeQL, Dependabot coverage, required results, review, and
  configuration. Code Quality is not security analysis.

## Validation and review

Use the Deno version pinned in `.github/workflows/ci.yml` and Gitleaks 8.30.1
from an official release or approved internal installation. From the repository
root:

```sh
./scripts/bootstrap
./scripts/test
./scripts/fuzz
./scripts/lint
./scripts/check-secrets
```

`./scripts/lint` checks formatting, lint, types, and import boundaries. Run
`./scripts/check-secrets --staged` immediately before committing. Report
commands, results, and any validation gaps in the PR; never hide a failing
check.

Before implementation/review, define outcome, acceptance criteria, affected
paths/tests, and non-goals. Limit changes to that outcome and supported
regressions introduced or worsened; report unrelated defects/improvements
separately. Obtain agreement before materially expanding scope, crossing
ownership boundaries, changing public APIs, or restructuring architecture.
Security-sensitive changes require security review and focused regressions.
Submit PRs for [CODEOWNERS](.github/CODEOWNERS) approval under CONTRIBUTING.md.
