# Third-party notices

This document identifies third-party material retained in the current source
tree. The upstream Steady license is preserved in [LICENSE](LICENSE), and
[PROVENANCE.md](PROVENANCE.md) records the source snapshot and import history.
These notices do not change the licenses of the identified files.

## OpenAPI 3.1 schema

- **Local file:**
  [packages/openapi/schemas/openapi-3.1.json](packages/openapi/schemas/openapi-3.1.json)
- **Copyright:** The Linux Foundation.
- **License:** Apache License, Version 2.0. The complete license is preserved in
  [licenses/OpenAPI.txt](licenses/OpenAPI.txt).
- **Source:**
  [OpenAPI Specification commit `157a4c81ae537ef793b2bee368bc00d88b461de8`](https://github.com/OAI/OpenAPI-Specification/blob/157a4c81ae537ef793b2bee368bc00d88b461de8/schemas/v3.1/schema.json),
  schema dated 2022-10-07.
- **Modifications:** Added the HTTP `query` operation under
  `/$defs/path-item/properties/query` and changed JSON formatting. The operation
  was added by
  [upstream Steady commit `baf0e53f39e8da80c553bd8e08eba958fa43dca2`](https://github.com/dgellow/steady/commit/baf0e53f39e8da80c553bd8e08eba958fa43dca2).
- **Verification:** The original and retained file hashes are recorded in
  [provenance/third-party.json](provenance/third-party.json). The pinned
  upstream source contains no separate root NOTICE file.

## Scope

The unused JSON Schema meta-schema copies are not present in the current tree.
[PROVENANCE.md](PROVENANCE.md) records their removal and historical source
records. Runtime and test dependencies are resolved separately through
[deno.lock](deno.lock). Any future binary or package distribution must include
the notices required for the material it bundles.
