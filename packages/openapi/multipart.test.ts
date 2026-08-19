import { assertEquals } from "@std/assert";
import { SchemaRegistry } from "@steady/json-schema";
import { getMediaType, type MediaTypeEssence } from "@steady/media-type";
import type { MediaTypeObject } from "./openapi.ts";
import { resolvePartContentTypes } from "./multipart.ts";

function essence(raw: string): MediaTypeEssence {
  const parsed = getMediaType(raw);
  if (!parsed) throw new Error(`Invalid media type: ${raw}`);
  return parsed;
}

const JSON_ESSENCE = essence("application/json");
const OCTET_STREAM_ESSENCE = essence("application/octet-stream");
const TEXT_PLAIN_ESSENCE = essence("text/plain");

/**
 * Build a minimal SchemaRegistry that indexes the given component
 * schemas. The spec is constructed via the typed OpenAPIRaw shape
 * and accepts untyped schema fragments via the Record map.
 */
function registryWith(
  schemas: Record<string, Record<string, unknown>>,
): SchemaRegistry {
  const spec = {
    openapi: "3.1.0",
    info: { title: "T", version: "1" },
    paths: {},
    components: { schemas },
  };
  return SchemaRegistry.fromSpec(spec);
}

Deno.test("resolvePartContentTypes", async (t) => {
  // ── Explicit encoding ────────────────────────────────────────────

  await t.step("explicit contentType application/json", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { metadata: { type: "object" } },
      },
      encoding: { metadata: { contentType: "application/json" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      metadata: JSON_ESSENCE,
    });
  });

  await t.step("explicit contentType application/xml", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { config: { type: "object" } },
      },
      encoding: { config: { contentType: "application/xml" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      config: essence("application/xml"),
    });
  });

  await t.step("explicit text/plain overrides object default", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { note: { type: "object" } },
      },
      encoding: { note: { contentType: "text/plain" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      note: TEXT_PLAIN_ESSENCE,
    });
  });

  await t.step("explicit image/png", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { avatar: { type: "string", format: "binary" } },
      },
      encoding: { avatar: { contentType: "image/png" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      avatar: essence("image/png"),
    });
  });

  await t.step("explicit structured suffix essence preserved", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { doc: { type: "object" } },
      },
      encoding: { doc: { contentType: "application/vnd.custom+json" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      doc: essence("application/vnd.custom+json"),
    });
  });

  // ── Reconciliation: explicit JSON vs non-JSON schema ─────────────

  await t.step(
    "explicit application/json on type: string primitive -> text/plain",
    () => {
      // The value is a string whose contents happen to be JSON text;
      // the Content-Type is transport metadata, not a decode directive.
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: { manifest: { type: "string" } },
        },
        encoding: { manifest: { contentType: "application/json" } },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        manifest: TEXT_PLAIN_ESSENCE,
      });
    },
  );

  await t.step(
    "explicit application/json on format: binary -> application/octet-stream",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: {
            blob: { type: "string", format: "binary" },
          },
        },
        encoding: { blob: { contentType: "application/json" } },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        blob: OCTET_STREAM_ESSENCE,
      });
    },
  );

  await t.step(
    "explicit +json suffix on type: string -> text/plain",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: { payload: { type: "string" } },
        },
        encoding: { payload: { contentType: "application/vnd.custom+json" } },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        payload: TEXT_PLAIN_ESSENCE,
      });
    },
  );

  // ── Implicit from schema ─────────────────────────────────────────

  await t.step("type: object -> application/json", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            properties: { x: { type: "string" } },
          },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      metadata: JSON_ESSENCE,
    });
  });

  await t.step("type: array of objects -> application/json", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object" } },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      items: JSON_ESSENCE,
    });
  });

  await t.step("type: array of arrays -> application/json", () => {
    // Array-of-arrays is a complex value per OAS 3.1, not "array of
    // primitives". Regression for an earlier implementation that
    // required items to be an object before returning JSON.
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          matrix: {
            type: "array",
            items: { type: "array", items: { type: "integer" } },
          },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      matrix: JSON_ESSENCE,
    });
  });

  await t.step(
    "type: array of binary strings -> application/octet-stream",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string", format: "binary" },
            },
          },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        files: OCTET_STREAM_ESSENCE,
      });
    },
  );

  await t.step(
    "type: string, format: binary -> application/octet-stream",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: { script: { type: "string", format: "binary" } },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        script: OCTET_STREAM_ESSENCE,
      });
    },
  );

  await t.step(
    "type: string, contentEncoding -> application/octet-stream",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: {
            blob: { type: "string", contentEncoding: "base64" },
          },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        blob: OCTET_STREAM_ESSENCE,
      });
    },
  );

  await t.step("type: string (primitive) -> text/plain", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      name: TEXT_PLAIN_ESSENCE,
    });
  });

  await t.step("type: integer -> text/plain", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { count: { type: "integer" } },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      count: TEXT_PLAIN_ESSENCE,
    });
  });

  await t.step("type: array of primitives -> text/plain", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          tags: { type: "array", items: { type: "string" } },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      tags: TEXT_PLAIN_ESSENCE,
    });
  });

  // ── Composition ──────────────────────────────────────────────────

  await t.step("allOf wrapping type: object -> application/json", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          metadata: {
            allOf: [
              { type: "object", properties: { x: { type: "string" } } },
            ],
          },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {
      metadata: JSON_ESSENCE,
    });
  });

  await t.step(
    "anyOf containing object variant -> application/json",
    () => {
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: {
            metadata: {
              anyOf: [
                { type: "object", properties: { x: { type: "string" } } },
                { type: "null" },
              ],
            },
          },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        metadata: JSON_ESSENCE,
      });
    },
  );

  // ── $ref resolution via SchemaRegistry ───────────────────────────

  await t.step(
    "$ref property resolving to object -> application/json",
    () => {
      const registry = registryWith({
        Meta: {
          type: "object",
          properties: { x: { type: "string" } },
        },
      });
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: {
            metadata: { $ref: "#/components/schemas/Meta" },
          },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registry), {
        metadata: JSON_ESSENCE,
      });
    },
  );

  await t.step(
    "$ref property resolving to primitive -> text/plain",
    () => {
      const registry = registryWith({
        Name: { type: "string" },
      });
      const mt: MediaTypeObject = {
        schema: {
          type: "object",
          properties: { name: { $ref: "#/components/schemas/Name" } },
        },
      };
      assertEquals(resolvePartContentTypes(mt, registry), {
        name: TEXT_PLAIN_ESSENCE,
      });
    },
  );

  await t.step("root schema $ref resolves", () => {
    const registry = registryWith({
      Body: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            properties: { x: { type: "string" } },
          },
          name: { type: "string" },
        },
      },
    });
    const mt: MediaTypeObject = {
      schema: { $ref: "#/components/schemas/Body" },
    };
    assertEquals(resolvePartContentTypes(mt, registry), {
      metadata: JSON_ESSENCE,
      name: TEXT_PLAIN_ESSENCE,
    });
  });

  await t.step("unresolved $ref is omitted from result", () => {
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: {
          metadata: { $ref: "#/components/schemas/Missing" },
        },
      },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {});
  });

  // ── Edge cases ───────────────────────────────────────────────────

  await t.step(
    "explicit encoding on property absent from schema still emits entry",
    () => {
      const mt: MediaTypeObject = {
        schema: { type: "object", properties: {} },
        encoding: { extra: { contentType: "application/json" } },
      };
      assertEquals(resolvePartContentTypes(mt, registryWith({})), {
        extra: JSON_ESSENCE,
      });
    },
  );

  await t.step("empty MediaTypeObject -> empty map", () => {
    assertEquals(resolvePartContentTypes({}, registryWith({})), {});
  });

  await t.step("unparseable explicit contentType is omitted", () => {
    // Empty string is rejected by the WHATWG MIME type parser.
    const mt: MediaTypeObject = {
      schema: {
        type: "object",
        properties: { blob: { type: "string" } },
      },
      encoding: { blob: { contentType: "" } },
    };
    assertEquals(resolvePartContentTypes(mt, registryWith({})), {});
  });
});
