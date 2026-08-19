export {
  checkGeneratedValue,
  checkResponseBytes,
  GenerationLimitError,
  MAX_GENERATED_ARRAY_ITEMS,
  MAX_RESPONSE_BYTES,
} from "./generation-limits.ts";
// Core components
export {
  RegistryResponseGenerator,
  SchemaRegistry,
} from "./schema-registry.ts";
export type {
  DocIndex,
  RegistrySchema,
  SchemaRegistryOptions,
} from "./schema-registry.ts";

// Re-export FragmentPointer from json-pointer for convenience
export type { FragmentPointer } from "@steady/json-pointer";

// Tree validation
export { TreeValidator } from "./tree-validator.ts";
export type { ValidationNode } from "./tree-validator.ts";

// Types
export type {
  ComplexityMetrics,
  GenerateContext,
  GenerateOptions,
  JsonSchemaDialect,
  JsonSchemaDialects,
  ProcessedSchema,
  Schema,
  SchemaError,
  SchemaMetadata,
  SchemaProcessResult,
  SchemaSource,
  SchemaType,
  SchemaValidationError,
  SchemaValidationResult,
  SchemaWarning,
  ValidatorOptions,
} from "./types.ts";
export { isSchema } from "./types.ts";

// Core processing components
export { JsonSchemaProcessor } from "./processor.ts";

// Schema inspection and coercion utilities
export {
  coerceDeep,
  coerceFormValue,
  coerceScalar,
  effectiveItems,
  effectiveProperties,
  effectiveRequired,
  effectiveType,
  isArraySchema,
  isObjectSchema,
} from "./schema-utils.ts";
