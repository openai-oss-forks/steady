# Security policy

Report vulnerabilities privately through
[OpenAI's coordinated vulnerability
disclosure policy](https://openai.com/policies/coordinated-vulnerability-disclosure-policy)
or email disclosure@openai.com. Do not open a public issue with exploit details,
credentials, customer data, or an unsanitized reproduction.

## Supported use

This source-only checkout is a local SDK testing tool, not a production service.
Use trusted, reviewed OpenAPI specifications and synthetic data. The server must
remain bound to loopback; do not expose it through a proxy, tunnel, container
port mapping, or shared host. Runtime safety limits and redaction must not be
disabled to make a test pass.

Changes to request parsing, logging, response generation, dependencies,
execution permissions, or repository automation require security-conscious
review and regression tests. Report a suspected leaked credential privately and
have its owner revoke or rotate it; deleting it from a file is not sufficient.

Test and lint jobs use read-only permissions on GitHub-hosted runners, with
SHA-pinned actions, a checksum-verified Deno runtime, and frozen dependencies.
GitHub-managed CodeQL additionally scans JavaScript/TypeScript and Actions with
the extended security suite and reports results to code scanning. Preserve
required security results and code-scanning merge protection; Code Quality
checks are not a substitute. See the
[scanning policy](CONTRIBUTING.md#security-scanning) for coverage limits. Do not
provide PATs or repository secrets to these jobs. Package publishing,
third-party SDK integration jobs, and release automation remain disabled until
separately approved. Maintainers must complete the private staging review,
provenance review, secret scan, and destination repository controls before any
public import or release.
