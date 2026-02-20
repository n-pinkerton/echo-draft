export type Platform = "darwin" | "win32" | "linux";

export type ValidationErrorCode =
  | "TOO_MANY_KEYS"
  | "NO_MODIFIER_OR_SPECIAL"
  | "LEFT_RIGHT_MIX"
  | "LEFT_MODIFIER_ONLY"
  | "DUPLICATE"
  | "RESERVED"
  | "INVALID_GLOBE";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: ValidationErrorCode;
}

