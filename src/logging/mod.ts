/**
 * Logging Module - Exports all logging utilities
 */

// Logger interface and base class
export { BaseLogger } from "./logger.ts";
export type { Logger, LoggerOptions, LogLevel } from "./logger.ts";

// Logger implementations
export { TextLogger } from "./text-logger.ts";
export { JsonLogger } from "./json-logger.ts";
export { CILogger } from "./ci-logger.ts";

// Types
export type { RequestEvent, ShutdownEvent, StartupEvent } from "./types.ts";

// Formatting utilities
export {
  formatDiagnostic,
  formatDiagnostics,
  formatDiagnosticSummary,
  formatExplainHint,
  formatStartupDiagnostics,
} from "./format-diagnostic.ts";

// Colors
export {
  attributionColor,
  attributionLabel,
  colorize,
  colors,
  formatStatus,
  statusColor,
} from "./colors.ts";
