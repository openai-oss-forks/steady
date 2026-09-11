# Contributing

The maintainers listed in [CODEOWNERS](.github/CODEOWNERS) review and approve
changes to this source-only snapshot. Every change to `main` requires a pull
request and maintainer approval; CODEOWNERS covers the entire repository. Direct
pushes, force-pushes, and branch deletion are blocked. Open a small change with
a clear reason, focused regression tests, and local validation results. Use
synthetic fixtures; do not add vendor corpora, private keys, real credentials,
production requests, or unreviewed generated assets. Preserve license and
attribution notices. New upstream imports and dependency changes need a pinned
revision and provenance review. Keep the source and license records in
[PROVENANCE.md](PROVENANCE.md), [NOTICE](NOTICE), and
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

## Continuous integration

The CI workflow runs the local lint and test scripts on pull requests to `main`
and pushes to `main`, using Deno 2.9.6 on GitHub-hosted Ubuntu runners.
Dependencies are installed from the frozen lockfile. New npm and JSR dependency
versions must be at least 14 days old (`minimumDependencyAge: "P14D"`); do not
add age-policy exclusions. The workflow has only `contents: read` permission,
does not persist checkout credentials, and uses no repository secrets, PATs,
shared caches, or self-hosted runners.

Pin every external action to a full commit SHA with its release tag in a
comment. Select action and Deno releases that are at least 14 days old. When
updating Deno, update both the exact version and its official release archive
SHA-256; verify the checksum before executing the runtime. Use `pull_request`
for PR checks, never `pull_request_target` or a privileged `workflow_run` that
executes PR code. Keep package publishing, release automation, and third-party
SDK integration jobs disabled pending separate approval. See
[SECURITY.md](SECURITY.md) for private vulnerability reporting.
