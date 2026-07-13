import { describe, expect, it } from "vitest";

const { createOAuthStateManager } = require("./oauthState.js");

describe("OAuth state manager", () => {
  it("rejects unsolicited, wrong, expired, renderer-mismatched, and replayed callbacks", () => {
    let now = 1_000_000;
    const manager = createOAuthStateManager({
      now: () => now,
      randomBytes: () => Buffer.alloc(32, 1),
      ttlMs: 60_000,
    });
    const issued = manager.issue({ rendererId: 17 });
    const wrongState = Buffer.alloc(32, 2).toString("base64url");

    expect(manager.consume({ state: wrongState, rendererId: 17 })).toMatchObject({
      accepted: false,
      reason: "state-mismatch",
    });
    expect(manager.consume({ state: issued.state, rendererId: 18 })).toMatchObject({
      accepted: false,
      reason: "renderer-mismatch",
    });
    expect(manager.consume({ state: issued.state, rendererId: 17 })).toEqual({ accepted: true });
    expect(manager.consume({ state: issued.state, rendererId: 17 })).toMatchObject({
      accepted: false,
      reason: "no-pending-session",
    });

    const expiring = manager.issue({ rendererId: 17 });
    now += 60_001;
    expect(manager.consume({ state: expiring.state, rendererId: 17 })).toMatchObject({
      accepted: false,
      reason: "expired-session",
    });
  });

  it("invalidates the previous state when a new sign-in starts", () => {
    let fill = 3;
    const manager = createOAuthStateManager({ randomBytes: () => Buffer.alloc(32, fill++) });
    const first = manager.issue({ rendererId: 4 });
    const second = manager.issue({ rendererId: 4 });

    expect(manager.consume({ state: first.state, rendererId: 4 })).toMatchObject({
      accepted: false,
      reason: "state-mismatch",
    });
    expect(manager.consume({ state: second.state, rendererId: 4 })).toEqual({ accepted: true });
  });
});
