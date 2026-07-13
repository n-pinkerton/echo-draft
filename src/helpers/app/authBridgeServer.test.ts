import { describe, expect, it } from "vitest";

const { isAllowedBridgeOrigin } = require("./authBridgeServer.js");

describe("development OAuth bridge origin policy", () => {
  const expectedOrigin = "http://localhost:5183";

  it("allows only the expected origin for CORS requests", () => {
    expect(isAllowedBridgeOrigin({ method: "POST", origin: expectedOrigin, expectedOrigin })).toBe(
      true
    );
    expect(
      isAllowedBridgeOrigin({
        method: "POST",
        origin: "https://attacker.example",
        expectedOrigin,
      })
    ).toBe(false);
    expect(isAllowedBridgeOrigin({ method: "POST", origin: "", expectedOrigin })).toBe(false);
  });

  it("allows an originless top-level GET but rejects a foreign-origin GET", () => {
    expect(isAllowedBridgeOrigin({ method: "GET", origin: "", expectedOrigin })).toBe(true);
    expect(
      isAllowedBridgeOrigin({
        method: "GET",
        origin: "https://attacker.example",
        expectedOrigin,
      })
    ).toBe(false);
  });
});
