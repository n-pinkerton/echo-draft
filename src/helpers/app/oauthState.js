const crypto = require("crypto");

const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isValidOAuthState(value) {
  return typeof value === "string" && OAUTH_STATE_PATTERN.test(value);
}

function createOAuthStateManager({
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  ttlMs = DEFAULT_OAUTH_STATE_TTL_MS,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 30_000 || ttlMs > 30 * 60 * 1000) {
    throw new Error("OAuth state TTL is outside the allowed range");
  }

  let pending = null;

  return {
    issue({ rendererId } = {}) {
      if (!Number.isInteger(rendererId) || rendererId < 1) {
        throw new Error("OAuth state requires a trusted renderer identity");
      }
      const state = randomBytes(32).toString("base64url");
      if (!isValidOAuthState(state)) {
        throw new Error("OAuth state generation failed");
      }
      pending = {
        state,
        rendererId,
        expiresAt: now() + ttlMs,
      };
      return { state, expiresAt: pending.expiresAt };
    },

    consume({ state, rendererId } = {}) {
      if (!isValidOAuthState(state)) return { accepted: false, reason: "invalid-state" };
      if (!pending) return { accepted: false, reason: "no-pending-session" };
      if (now() >= pending.expiresAt) {
        pending = null;
        return { accepted: false, reason: "expired-session" };
      }
      if (rendererId !== pending.rendererId) {
        return { accepted: false, reason: "renderer-mismatch" };
      }

      const provided = Buffer.from(state, "utf8");
      const expected = Buffer.from(pending.state, "utf8");
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        return { accepted: false, reason: "state-mismatch" };
      }

      pending = null;
      return { accepted: true };
    },

    clear() {
      pending = null;
    },
  };
}

module.exports = {
  DEFAULT_OAUTH_STATE_TTL_MS,
  OAUTH_STATE_PATTERN,
  createOAuthStateManager,
  isValidOAuthState,
};
