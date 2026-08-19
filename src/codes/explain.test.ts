import { assertEquals } from "@std/assert";
import { allCodes, type ECode, hasCode } from "./registry.ts";
import { EXPLANATIONS } from "./explanations.ts";

Deno.test("every registered code has a complete explanation", () => {
  const codes = Object.keys(allCodes()) as ECode[];

  for (const code of codes) {
    const explanation = EXPLANATIONS[code];

    assertEquals(
      typeof explanation.description,
      "string",
      `${code}: missing description`,
    );
    assertEquals(
      explanation.description.length > 0,
      true,
      `${code}: empty description`,
    );

    assertEquals(
      typeof explanation.reasoning,
      "string",
      `${code}: missing reasoning`,
    );
    assertEquals(
      explanation.reasoning.length > 0,
      true,
      `${code}: empty reasoning`,
    );

    assertEquals(
      typeof explanation.example,
      "string",
      `${code}: missing example`,
    );
    assertEquals(
      explanation.example.length > 0,
      true,
      `${code}: empty example`,
    );

    assertEquals(
      typeof explanation.fix,
      "string",
      `${code}: missing fix`,
    );
    assertEquals(explanation.fix.length > 0, true, `${code}: empty fix`);

    // seeAlso references must be valid codes
    if (explanation.seeAlso) {
      for (const ref of explanation.seeAlso) {
        assertEquals(
          hasCode(ref),
          true,
          `${code}: seeAlso references unknown code ${ref}`,
        );
      }
    }
  }
});
