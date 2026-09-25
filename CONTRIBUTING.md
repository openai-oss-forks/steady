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
Maintainers must preserve the repository's required reviews, Dependabot alerts
and security updates, secret scanning, and push protection. Dependabot opens
dependency-update pull requests for maintainer review; auto-merge is not
allowed. External contributions are not accepted until the contribution process
and required CLA tooling have been approved and enabled.

## Continuous integration

The CI workflow runs the local lint and test scripts on pull requests to `main`
and pushes to `main`, using Deno 2.9.6 on GitHub-hosted Ubuntu runners.
Dependencies are installed from the frozen lockfile. New npm and JSR dependency
versions must ordinarily be at least 14 days old
(`minimumDependencyAge: "P14D"`); do not add age-policy exclusions except
through the urgent security process below. The workflow has only
`contents: read` permission, does not persist checkout credentials, and uses no
repository secrets, PATs, shared caches, or self-hosted runners.

Pin every external action to a full commit SHA with its release tag in a
comment. Select action and Deno releases that are at least 14 days old. When
updating Deno, update both the exact version and its official release archive
SHA-256; verify the checksum before executing the runtime. The urgent security
process below is the only exception to the ordinary release-age requirement. Use
`pull_request` for PR checks, never `pull_request_target` or a privileged
`workflow_run` that executes PR code. Keep package publishing, release
automation, and third-party SDK integration jobs disabled pending separate
approval. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

### Security scanning

The [CodeQL workflow](.github/workflows/codeql.yml) scans JavaScript/TypeScript
and GitHub Actions with the extended security suite on pull requests (including
Dependabot), pushes to `main`, and weekly. Keep both languages enabled and
retain the `Analyze (actions)` and `Analyze (javascript-typescript)` job names.
The main ruleset requires both analyses and the CodeQL result, and blocks
code-scanning and security alerts at all severities. Preserve these requirements
as well as the lint and test checks; a successful Code Quality run does not
satisfy security scanning.

Before merging, verify both security analyses completed for the current revision
and triage their findings. Use advanced setup: GitHub-managed default setup does
not run the required analyses on Dependabot PRs. Keep default setup disabled
while this workflow is active. CodeQL jobs use GitHub-hosted runners, SHA-pinned
actions, no persisted checkout credentials or shared caches, and only
`contents: read` plus `security-events: write` for analysis uploads. The
`pull_request` event supports Dependabot analysis uploads without a PAT or
repository secret; never replace it with privileged `pull_request_target`.

Required status checks and maintainer review remain necessary; do not bypass a
missing security result. External contributions remain disabled. Before
accepting fork PRs or enabling a merge queue, verify scanning and enforcement
for those events. See GitHub's
[advanced setup guidance](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning)
and
[merge protection limitations](https://docs.github.com/en/code-security/concepts/code-scanning/merge-protection).

## Dependency updates

[Dependabot](.github/dependabot.yml) checks Deno and GitHub Actions weekly with
a 14-day cooldown for ordinary updates. The root Deno job covers `deno.json`,
the `packages/*` workspace manifests, and their shared `deno.lock`. Keep imports
at exact versions and Actions at full SHAs with release-tag comments. Review the
release date, upstream changes, provenance, licenses, and all transitive
lockfile changes before merging, even when the PR is automated. Missing
release-date metadata is not an exemption from the 14-day policy. Run the
validation commands above and `./scripts/bootstrap` against the committed frozen
lockfile. Do not merge a manifest-only update that leaves the lockfile stale,
remove integrity hashes, or disable frozen installs to get CI passing.

Keep all `github/codeql-action/*` steps on the same release SHA. The `codeql`
Dependabot group updates them together, including major versions; preserve this
group instead of updating `init` and `analyze` independently. The regular test
suite checks that the workflow pins match, including for manual updates.

The repository Actions allowlist must permit `github/codeql-action/init@*` and
`github/codeql-action/analyze@*`, with full-SHA pinning still required. The
pattern `github/codeql-action@*` does not cover these sub-actions, and allowing
only one release SHA prevents reviewed Dependabot updates from running. Keep the
workflow itself pinned to the reviewed release SHA.

Maintainers listed in CODEOWNERS must check updater jobs and review pending PRs
at least weekly. After this configuration reaches `main`, use **Insights >
Dependency graph > Dependabot > Recent update jobs** to confirm both ecosystems
run successfully. Inspect the first Deno update for workspace discovery, exact
pins, and a matching lockfile; confirm its frozen bootstrap and CI pass. Record
the job and PR links as verification evidence. Until those runs occur, hosted
updater verification is pending. If an update job fails, a maintainer must
prepare the scoped update manually and investigate the failure; do not silently
leave updates paused.

### Security coverage and response

Keep repository-level Dependabot security updates enabled and unpaused under
**Settings > Advanced Security**. Security PRs do not wait for the weekly
version schedule or Dependabot cooldown. However, Deno's own age policy may
still block a fresh fix; use the urgent process below rather than waiting for
maturity.

GitHub documents Deno version and security updates, including JSR/npm manifest
updates, but that does not guarantee advisory coverage for every package. JSR
advisory coverage is not established by the version updater; do not treat zero
Dependabot alerts as a clean bill of health. GitHub also documents that
SHA-pinned Actions do not generate vulnerability alerts. The downloaded Deno
runtime and its checksum are maintained manually, outside Dependabot's `uses:`
updates. Maintainers must monitor upstream advisories and releases for Deno, JSR
packages (including transitives), and Actions at least weekly, and respond
immediately to incoming security reports. Review new alerts promptly; escalate
urgent or actively exploited issues to the maintainers and OpenAI security
through the private reporting route in SECURITY.md on the day they are received.

### Urgent security updates

Do not wait 14 days to address a confirmed urgent vulnerability. A maintainer
must prepare the smallest patched update or mitigation immediately, manually if
Dependabot cannot produce it. Before merging a release younger than 14 days,
obtain explicit approval from a CODEOWNER and the OpenAI security responder via
the private reporting route in SECURITY.md. Record the advisory, affected and
fixed versions, release time, reason waiting is unsafe, provenance review,
validation results, owner, and expiry of any exception. Keep sensitive details
in the private report and reference its identifier in the PR.

If Deno rejects the approved package on age grounds, the security PR may
temporarily use the object form of `minimumDependencyAge`, retaining
`"age": "P14D"` and excluding only the named `jsr:` or `npm:` package(s) needed
for the fix. Every exempt package must remain pinned to the approved exact
version in the lockfile; review any transitive changes separately. No wildcards,
global age reduction, or routine-update exemptions are allowed. Regenerate the
lockfile locally with `deno install --frozen=false`, commit it with the exact
manifest pins, then run the frozen bootstrap and all validation commands above.
Do not merge unrelated updates to exempt packages. The named maintainer must
remove the exclusion and restore `minimumDependencyAge: "P14D"` as soon as the
approved versions are 14 days old, with that deadline recorded in the PR.

Urgent Actions and Deno runtime updates need the same approval and provenance
review; keep their SHA pins and verified archive checksums. Maintainer review,
required checks, lockfile integrity, and secret protections always apply. If a
safe update is unavailable, agree a mitigation with the security responder.

Support references:
[ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories),
[cooldown](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown),
[alert coverage](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems),
and
[Deno age configuration](https://docs.deno.com/runtime/reference/deno_json/#minimum-dependency-age).
