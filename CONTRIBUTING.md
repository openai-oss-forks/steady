# Contributing

The [SDK maintainers](https://github.com/orgs/openai/teams/sdks-team) review and
approve changes to this source-only snapshot. Every change to `main` requires a
pull request and SDK-team approval; [CODEOWNERS](.github/CODEOWNERS) covers the
entire repository. Direct pushes, force-pushes, and branch deletion are blocked.
Open a small change with a clear reason, focused regression tests, and local
validation results. Use synthetic fixtures; do not add vendor corpora, private
keys, real credentials, production requests, or unreviewed generated assets.
Preserve license and attribution notices. New upstream imports and dependency
changes need a pinned revision and provenance review. Keep the source and
license records in [PROVENANCE.md](PROVENANCE.md), [NOTICE](NOTICE), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) current.

Run `./scripts/test`, `./scripts/fuzz`, `./scripts/lint`, and
`./scripts/check-secrets` before requesting review. The secret check requires
Gitleaks 8.30.1 from its official release or an approved internal installation.
Run `./scripts/check-secrets --staged` immediately before committing.

The repository includes a local pre-commit configuration. Preserve managed Git
hooks, including PushPatrol: do not replace `core.hooksPath`, use `--no-verify`,
or install over an existing managed hook. Arrange automatic invocation through
the approved hook chain; until then, run the staged check explicitly.
Maintainers must preserve the repository's required reviews, Dependabot alerts,
secret scanning, and push protection. Dependabot may report vulnerabilities, but
automated dependency-update pull requests remain disabled. External
contributions are not accepted until the contribution process and required CLA
tooling have been approved and enabled.

Keep all hosted CI and publishing workflows absent pending separate approval.
See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
