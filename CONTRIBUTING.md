# Contributing

The SDK maintainers review and approve changes to this source-only snapshot.
Open a small change with a clear reason, focused regression tests, and local
validation results. Use synthetic fixtures; do not add vendor corpora, private
keys, real credentials, production requests, or unreviewed generated assets.
Preserve license and attribution notices. New upstream imports and dependency
changes need a pinned revision and provenance review.

Run `./scripts/test`, `./scripts/fuzz`, `./scripts/lint`, and
`./scripts/check-secrets` before requesting review. The secret check requires
Gitleaks 8.30.1 from its official release or an approved internal installation.
Run `./scripts/check-secrets --staged` immediately before committing.

The repository includes a local pre-commit configuration. Preserve managed Git
hooks, including PushPatrol: do not replace `core.hooksPath`, use `--no-verify`,
or install over an existing managed hook. Arrange automatic invocation through
the approved hook chain; until then, run the staged check explicitly.
Maintainers must verify destination-specific CODEOWNERS, access, branch
protection, secret scanning, and push protection before enabling collaboration
or publication.

Keep all hosted CI and publishing workflows absent pending separate approval.
See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
