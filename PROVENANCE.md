# Source provenance

## Steady source

This repository began as a source-only snapshot of
[`dgellow/steady@983ba871c94a6628c64568252bb2b61d753bcff1`](https://github.com/dgellow/steady/commit/983ba871c94a6628c64568252bb2b61d753bcff1)
(v0.22.2). The upstream maintainer changed the project license from Elastic-2.0
to MIT in
[`7c0c5c4ee5e903e8541f8f650cedaa36cbbbe337`](https://github.com/dgellow/steady/commit/7c0c5c4ee5e903e8541f8f650cedaa36cbbbe337).
The imported [LICENSE](LICENSE) preserves that revision's copyright and
permission notice byte-for-byte.

The import excludes upstream Git history, branches, issues, pull requests,
releases, packages, Actions history, workflows, the logo, research directories,
vendor API fixtures, and third-party test-suite submodules. OpenAI's changes
include logging redaction, loopback-only TCP binding, resource limits, synthetic
regression fixtures, pinned dependencies, and local security guidance. No
upstream package or release binary is redistributed.

The two outside pull requests identified during the license-history review were
made before the MIT change:

- [#113](https://github.com/dgellow/steady/pull/113) changed the grammar of the
  README's opening description. That description has been independently reworded
  here.
- [#114](https://github.com/dgellow/steady/pull/114) changed the upstream
  SDK-test workflow. That workflow is excluded from this repository.

Upstream history also contains AI-attributed commits. The public history and
license change establish what upstream published; they do not independently
prove the maintainer's rights in every contribution or the origin of every
AI-assisted change. Any unresolved rights question must be addressed with the
appropriate rights holder and legal reviewer before public redistribution. This
document records evidence, not a legal determination or release authorization.

## Retained standards files

The [machine-readable inventory](provenance/third-party.json) records each local
file's SHA-256, its immutable upstream source, the upstream SHA-256, and any
changes. The source comparisons were checked against parsed JSON as well as
exact bytes where applicable.

| Local files                                                                                              | Official source                                                                                                                                         | License and changes                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/json-schema/spec/schema`                                                                       | [JSON Schema `schema.json` at `add836e`](https://github.com/json-schema-org/json-schema-spec/blob/add836e705c9a07434c467b6b90946ba45258a73/schema.json) | BSD-3-Clause option; byte-identical                                                  |
| `packages/json-schema/spec/{applicator,content,core,format-annotation,meta-data,unevaluated,validation}` | [JSON Schema `meta/` at `add836e`](https://github.com/json-schema-org/json-schema-spec/tree/add836e705c9a07434c467b6b90946ba45258a73/meta)              | BSD-3-Clause option; root `$vocabulary` annotations omitted, with formatting changes |
| `packages/openapi/schemas/openapi-3.1.json`                                                              | [OpenAPI schema at `157a4c81`](https://github.com/OAI/OpenAPI-Specification/blob/157a4c81ae537ef793b2bee368bc00d88b461de8/schemas/v3.1/schema.json)     | Apache-2.0; added HTTP `query` operation and formatting changes                      |

The JSON Schema license text comes from the project's
[explicit license clarification](https://github.com/json-schema-org/json-schema-spec/blob/51326f80900357fe3069beb4f5f575db24c1b9a7/LICENSE)
and is preserved in [licenses/JSON-Schema.txt](licenses/JSON-Schema.txt). The
OpenAPI license is preserved from the same pinned source revision in
[licenses/OpenAPI.txt](licenses/OpenAPI.txt). The QUERY extension came from
[upstream Steady commit `baf0e53f`](https://github.com/dgellow/steady/commit/baf0e53f39e8da80c553bd8e08eba958fa43dca2).
Attribution and modification notices are collected in [NOTICE](NOTICE).

The two upstream JSON Schema HTML placeholders contained no specification text
and have been removed. Runtime and test dependencies are resolved separately
from the exact versions and integrity hashes in [deno.lock](deno.lock); their
source code is not vendored in this snapshot. Any future binary or package
distribution must review and include the notices required for what it bundles.
