# Agent guidance

Steady is a source-only, local SDK testing tool that validates HTTP requests
against OpenAPI specifications and generates mock responses. Read
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

- Preserve exact dependency versions, the frozen lockfile, and the existing
  `minimumDependencyAge: "P14D"` policy for ordinary updates. Dependabot opens
  Deno and GitHub Actions update PRs for maintainer review; do not enable
  auto-merge. Follow [CONTRIBUTING.md](CONTRIBUTING.md#dependency-updates) for
  maturity and provenance requirements. Only its
  [urgent security process](CONTRIBUTING.md#urgent-security-updates) permits
  explicitly approved, narrowly scoped, temporary age-policy exceptions.
- Review provenance for dependency changes and upstream imports. Preserve pinned
  revisions, license/attribution notices, and the records described in
  [PROVENANCE.md](PROVENANCE.md). Do not import vendor corpora or unreviewed
  assets.
- Keep CI on GitHub-hosted runners with `contents: read`, no persisted checkout
  credentials, and full-SHA-pinned external actions with release-tag comments.
  Verify the pinned Deno archive checksum and install frozen dependencies. Do
  not add PATs, repository secrets, shared caches, self-hosted runners, or
  privileged PR-code execution; follow the workflow rules in
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Publishing, release automation, and third-party SDK integration jobs require
  separate approval and remain disabled. Preserve managed hooks, required
  reviews, secret scanning, and push protection; never bypass hooks or overwrite
  their configuration.
- Preserve the explicit CodeQL workflow for JavaScript/TypeScript and Actions,
  including Dependabot PR coverage and required results. Code Quality runs do
  not replace security analysis. Follow
  [CONTRIBUTING.md](CONTRIBUTING.md#security-scanning) for review requirements
  and scanning configuration.

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

Before implementation or review, define the requested outcome, acceptance
criteria, affected paths/tests, and explicit non-goals. Keep the diff limited to
that outcome and supported regressions it introduces or worsens. Report
unrelated defects and broader improvements separately. Obtain agreement before
materially expanding scope, crossing ownership boundaries, changing public APIs,
or restructuring architecture. Security-sensitive changes need security review
and focused regression coverage. Submit changes through a PR with approval from
the maintainers in [CODEOWNERS](.github/CODEOWNERS), as required by
[CONTRIBUTING.md](CONTRIBUTING.md).
