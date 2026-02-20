export type { Platform, ValidationErrorCode, ValidationResult } from "./hotkeyValidator/types";
export { VALIDATION_RULES } from "./hotkeyValidator/constants";
export { normalizeHotkey } from "./hotkeyValidator/normalization";
export {
  getRecommendedPatterns,
  getReservedShortcuts,
  getValidExamples,
  getValidationMessage,
  validateHotkey,
} from "./hotkeyValidator/validation";
