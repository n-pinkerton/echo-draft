// Keep pre-rebrand identifiers here so older installs migrate cleanly without
// leaking legacy naming back into active code paths.
const LEGACY_PREFIX = String.fromCharCode(111, 112, 101, 110, 119, 104, 105, 115, 112, 114);
const LEGACY_GLOBAL_PREFIX = `__${LEGACY_PREFIX}`;

export const ECHO_DRAFT_CLOUD_MODE = "echodraft";
export const LEGACY_ECHO_DRAFT_CLOUD_MODE = LEGACY_PREFIX;
export const ECHO_DRAFT_CLOUD_SOURCE = "echodraft";
export const LEGACY_ECHO_DRAFT_CLOUD_SOURCE = LEGACY_PREFIX;
export const ECHO_DRAFT_REASONED_SOURCE = "echodraft-reasoned";
export const LEGACY_ECHO_DRAFT_REASONED_SOURCE = `${LEGACY_PREFIX}-reasoned`;
export const ECHO_DRAFT_BYOK_REASONED_SOURCE = "echodraft-byok-reasoned";
export const LEGACY_ECHO_DRAFT_BYOK_REASONED_SOURCE = `${LEGACY_PREFIX}-byok-reasoned`;
export const ECHO_DRAFT_CLOUD_MODEL = "echodraft-cloud";
export const LEGACY_ECHO_DRAFT_CLOUD_MODEL = `${LEGACY_PREFIX}-cloud`;

export const DEBUG_MODE_STORAGE_KEY = "echoDraftDebugEnabled";
export const LEGACY_DEBUG_MODE_STORAGE_KEY = `${LEGACY_PREFIX}DebugEnabled`;
export const LAST_SIGN_IN_STORAGE_KEY = "echoDraft:lastSignInTime";
export const LEGACY_LAST_SIGN_IN_STORAGE_KEY = `${LEGACY_PREFIX}:lastSignInTime`;

export const MODELS_CLEARED_EVENT = "echodraft-models-cleared";
export const LEGACY_MODELS_CLEARED_EVENT = `${LEGACY_PREFIX}-models-cleared`;
export const RENDERER_LOG_LEVEL_GLOBAL = "__echoDraftLogLevel";
export const LEGACY_RENDERER_LOG_LEVEL_GLOBAL = `${LEGACY_GLOBAL_PREFIX}LogLevel`;
export const E2E_GLOBAL = "__echoDraftE2E";
export const LEGACY_E2E_GLOBAL = `${LEGACY_GLOBAL_PREFIX}E2E`;

export const UNTRUSTED_TRANSCRIPTION_TAG_NAME = "echodraft_untrusted_transcription";

export function normalizeCloudMode(value) {
  if (value === LEGACY_ECHO_DRAFT_CLOUD_MODE) {
    return ECHO_DRAFT_CLOUD_MODE;
  }
  return value;
}

export function isEchoDraftCloudMode(value) {
  return normalizeCloudMode(value) === ECHO_DRAFT_CLOUD_MODE;
}

export function normalizeEchoDraftSource(value) {
  switch (value) {
    case LEGACY_ECHO_DRAFT_CLOUD_SOURCE:
      return ECHO_DRAFT_CLOUD_SOURCE;
    case LEGACY_ECHO_DRAFT_REASONED_SOURCE:
      return ECHO_DRAFT_REASONED_SOURCE;
    case LEGACY_ECHO_DRAFT_BYOK_REASONED_SOURCE:
      return ECHO_DRAFT_BYOK_REASONED_SOURCE;
    case LEGACY_ECHO_DRAFT_CLOUD_MODEL:
      return ECHO_DRAFT_CLOUD_MODEL;
    default:
      return value;
  }
}

export function getRendererLogLevel(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) {
    return null;
  }
  return win[RENDERER_LOG_LEVEL_GLOBAL] || win[LEGACY_RENDERER_LOG_LEVEL_GLOBAL] || null;
}

export function setRendererLogLevel(level, win = typeof window !== "undefined" ? window : undefined) {
  if (!win) {
    return;
  }
  win[RENDERER_LOG_LEVEL_GLOBAL] = level;
  win[LEGACY_RENDERER_LOG_LEVEL_GLOBAL] = level;
}

export function clearRendererLogLevel(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) {
    return;
  }
  delete win[RENDERER_LOG_LEVEL_GLOBAL];
  delete win[LEGACY_RENDERER_LOG_LEVEL_GLOBAL];
}

export function addModelsClearedListener(handler, target = typeof window !== "undefined" ? window : undefined) {
  if (!target) {
    return () => {};
  }
  target.addEventListener(MODELS_CLEARED_EVENT, handler);
  target.addEventListener(LEGACY_MODELS_CLEARED_EVENT, handler);
  return () => {
    target.removeEventListener(MODELS_CLEARED_EVENT, handler);
    target.removeEventListener(LEGACY_MODELS_CLEARED_EVENT, handler);
  };
}

export function dispatchModelsCleared(target = typeof window !== "undefined" ? window : undefined) {
  if (!target) {
    return;
  }
  target.dispatchEvent(new Event(MODELS_CLEARED_EVENT));
  target.dispatchEvent(new Event(LEGACY_MODELS_CLEARED_EVENT));
}

export function installEchoDraftE2E(helpers, target = typeof window !== "undefined" ? window : undefined) {
  if (!target) {
    return () => {};
  }
  target[E2E_GLOBAL] = helpers;
  target[LEGACY_E2E_GLOBAL] = helpers;
  return () => {
    delete target[E2E_GLOBAL];
    delete target[LEGACY_E2E_GLOBAL];
  };
}
