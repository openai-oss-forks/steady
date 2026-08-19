import { assertEquals, assertExists } from "@std/assert";
import { getMediaType } from "@steady/media-type";
import type { MediaTypeEssence } from "@steady/media-type";
import type { OperationInfo } from "./types.ts";

function mediaType(s: string): MediaTypeEssence {
  const result = getMediaType(s);
  if (!result) throw new Error(`Invalid media type in test: ${s}`);
  return result;
}
import { buildBaseline } from "./request-builder.ts";
import {
  extraProperty,
  omitRequiredBody,
  omitRequiredBodyField,
  removeRequiredHeaderParam,
  removeRequiredQueryParam,
  wrongBodyFieldType,
  wrongContentType,
  wrongEnumValue,
} from "./mutators.ts";

// ── Test fixtures ─────────────────────────────────────────────────

const CREATE_USER: OperationInfo = {
  path: "/users",
  method: "post",
  pathParams: [],
  queryParams: [
    {
      name: "api_key",
      in: "query",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "verbose",
      in: "query",
      required: false,
      schema: { type: "boolean" },
    },
  ],
  headerParams: [
    {
      name: "X-Request-Id",
      in: "header",
      required: true,
      schema: { type: "string" },
    },
  ],
  bodyInfo: {
    schema: {
      type: "object",
      required: ["name", "email", "role"],
      properties: {
        name: { type: "string" },
        email: { type: "string", format: "email" },
        age: { type: "integer" },
        role: { type: "string", enum: ["admin", "user", "viewer"] },
      },
      additionalProperties: false,
    },
    required: true,
    contentTypes: [mediaType("application/json")],
  },
};

const LIST_ITEMS: OperationInfo = {
  path: "/items",
  method: "get",
  pathParams: [],
  queryParams: [
    { name: "limit", in: "query", required: true, schema: { type: "integer" } },
    {
      name: "offset",
      in: "query",
      required: true,
      schema: { type: "integer" },
    },
  ],
  headerParams: [],
  bodyInfo: null,
};

const HEALTH_CHECK: OperationInfo = {
  path: "/health",
  method: "get",
  pathParams: [],
  queryParams: [],
  headerParams: [],
  bodyInfo: null,
};

// ── Tests ─────────────────────────────────────────────────────────

Deno.test("mutators", async (t) => {
  await t.step("removeRequiredQueryParam", async (t) => {
    await t.step("generates one case per required query param", () => {
      const baseline = buildBaseline(LIST_ITEMS);
      const cases = removeRequiredQueryParam.apply(LIST_ITEMS, baseline);

      assertEquals(cases.length, 2);
      const c0 = cases[0];
      const c1 = cases[1];
      assertExists(c0);
      assertExists(c1);
      assertEquals(c0.mutation, "remove required query param 'limit'");
      assertEquals(c1.mutation, "remove required query param 'offset'");
      assertEquals(c0.detail.location, "query");
    });

    await t.step("skips optional params", () => {
      const baseline = buildBaseline(CREATE_USER);
      const cases = removeRequiredQueryParam.apply(CREATE_USER, baseline);
      assertEquals(cases.length, 1);
    });

    await t.step("returns empty when no required query params", () => {
      const baseline = buildBaseline(HEALTH_CHECK);
      const cases = removeRequiredQueryParam.apply(HEALTH_CHECK, baseline);
      assertEquals(cases.length, 0);
    });
  });

  await t.step("removeRequiredHeaderParam", async (t) => {
    await t.step("generates case for required header", () => {
      const baseline = buildBaseline(CREATE_USER);
      const cases = removeRequiredHeaderParam.apply(CREATE_USER, baseline);
      assertEquals(cases.length, 1);
      const c0 = cases[0];
      assertExists(c0);
      assertEquals(c0.detail.location, "header");
    });

    await t.step("returns empty when no required headers", () => {
      const baseline = buildBaseline(LIST_ITEMS);
      const cases = removeRequiredHeaderParam.apply(LIST_ITEMS, baseline);
      assertEquals(cases.length, 0);
    });

    await t.step(
      "skips fetch-managed headers like Accept and User-Agent",
      () => {
        const op: OperationInfo = {
          path: "/downloads",
          method: "get",
          pathParams: [],
          queryParams: [],
          headerParams: [
            {
              name: "Accept",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "User-Agent",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "Accept-Language",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "X-Custom",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          bodyInfo: null,
        };
        const baseline = buildBaseline(op);
        const cases = removeRequiredHeaderParam.apply(op, baseline);
        // Only X-Custom should produce a case; Accept, User-Agent, Accept-Language
        // are managed by fetch() and cannot be reliably removed
        assertEquals(cases.length, 1);
        assertEquals(cases[0]!.mutation, "remove required header 'X-Custom'");
      },
    );
  });

  await t.step("wrongContentType", async (t) => {
    await t.step("swaps content-type to text/plain", () => {
      const baseline = buildBaseline(CREATE_USER);
      const cases = wrongContentType.apply(CREATE_USER, baseline);
      assertEquals(cases.length, 1);
      const c0 = cases[0];
      assertExists(c0);
      assertEquals(c0.request.headers["content-type"], "text/plain");
      assertEquals(c0.detail.location, "contentType");
    });

    await t.step("returns empty when no body", () => {
      const baseline = buildBaseline(LIST_ITEMS);
      const cases = wrongContentType.apply(LIST_ITEMS, baseline);
      assertEquals(cases.length, 0);
    });
  });

  await t.step("omitRequiredBody", async (t) => {
    await t.step("removes body when required", () => {
      const baseline = buildBaseline(CREATE_USER);
      const cases = omitRequiredBody.apply(CREATE_USER, baseline);
      assertEquals(cases.length, 1);
      const c0 = cases[0];
      assertExists(c0);
      assertEquals(c0.request.body, undefined);
    });

    await t.step("returns empty when no body required", () => {
      const baseline = buildBaseline(LIST_ITEMS);
      const cases = omitRequiredBody.apply(LIST_ITEMS, baseline);
      assertEquals(cases.length, 0);
    });
  });

  await t.step("omitRequiredBodyField", () => {
    const baseline = buildBaseline(CREATE_USER);
    const cases = omitRequiredBodyField.apply(CREATE_USER, baseline);
    // 3 required fields: name, email, role
    assertEquals(cases.length, 3);
    const c0 = cases[0];
    assertExists(c0);
    assertEquals(c0.detail.fieldDepth, 0);
  });

  await t.step("wrongBodyFieldType", () => {
    const baseline = buildBaseline(CREATE_USER);
    const cases = wrongBodyFieldType.apply(CREATE_USER, baseline);
    // 4 typed fields: name(string), email(string), age(integer), role(string)
    assertEquals(cases.length, 4);
    const ageCase = cases.find((c) => c.mutation.includes("'age'"));
    assertExists(ageCase);
    assertEquals(ageCase.detail.fieldType, "integer");
  });

  await t.step("extraProperty", async (t) => {
    await t.step("adds field when additionalProperties: false", () => {
      const baseline = buildBaseline(CREATE_USER);
      const cases = extraProperty.apply(CREATE_USER, baseline);
      assertEquals(cases.length, 1);
    });

    await t.step("returns empty when additionalProperties not false", () => {
      const op: OperationInfo = {
        ...CREATE_USER,
        bodyInfo: {
          schema: { type: "object", properties: { name: { type: "string" } } },
          required: true,
          contentTypes: [mediaType("application/json")],
        },
      };
      const baseline = buildBaseline(op);
      const cases = extraProperty.apply(op, baseline);
      assertEquals(cases.length, 0);
    });
  });

  await t.step("wrongEnumValue", () => {
    const baseline = buildBaseline(CREATE_USER);
    const cases = wrongEnumValue.apply(CREATE_USER, baseline);
    // Only 'role' has an enum
    assertEquals(cases.length, 1);
    const c0 = cases[0];
    assertExists(c0);
    assertEquals(c0.mutation, "wrong enum value for body field 'role'");
  });
});
