import { describe, expect, it } from "vitest";

const { getCachedToken, isTokenValid } = require("./tokenCache");
const { TOKEN_EXPIRY_MS, TOKEN_REFRESH_BUFFER_MS } = require("./constants");

describe("assemblyAiStreaming tokenCache", () => {
  it("treats missing token or timestamp as invalid", () => {
    expect(isTokenValid(null, Date.now())).toBe(false);
    expect(isTokenValid("t", null)).toBe(false);
  });

  it("expires token before hard expiry (refresh buffer)", () => {
    const now = 1_000_000;
    const limit = TOKEN_EXPIRY_MS - TOKEN_REFRESH_BUFFER_MS;

    expect(isTokenValid("t", now - (limit - 1), now)).toBe(true);
    expect(isTokenValid("t", now - limit, now)).toBe(false);
    expect(getCachedToken("t", now - limit, now)).toBeNull();
  });
});

