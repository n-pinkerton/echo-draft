import { afterEach, describe, expect, it, vi } from "vitest";

const { acceptOAuthCallback, parseOAuthCallbackUrl } = require("./oauthDeepLink.js");
const { createOAuthStateManager } = require("./oauthState.js");

const verifier = "verifier_" + "a".repeat(32);
const state = Buffer.alloc(32, 7).toString("base64url");

describe("OAuth callback boundary", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("accepts only the exact protocol host, path, and two singular parameters", () => {
    const valid = `echodraft://auth/callback?neon_auth_session_verifier=${verifier}&oauth_state=${state}`;
    expect(parseOAuthCallbackUrl(valid, "echodraft")).toEqual({ verifier, state });

    for (const invalid of [
      `echodraft://evil/callback?neon_auth_session_verifier=${verifier}&oauth_state=${state}`,
      `echodraft://auth/other?neon_auth_session_verifier=${verifier}&oauth_state=${state}`,
      `echodraft://auth/callback?neon_auth_session_verifier=${verifier}`,
      `echodraft://auth/callback?neon_auth_session_verifier=${verifier}&oauth_state=${state}&extra=1`,
      `echodraft://auth/callback?neon_auth_session_verifier=${verifier}&neon_auth_session_verifier=${verifier}&oauth_state=${state}`,
    ]) {
      expect(parseOAuthCallbackUrl(invalid, "echodraft")).toBeNull();
    }
  });

  it("consumes state once and binds it to the initiating control-panel renderer", () => {
    process.env.NODE_ENV = "development";
    const manager = createOAuthStateManager({ randomBytes: () => Buffer.alloc(32, 7) });
    manager.issue({ rendererId: 21 });
    const controlPanelWindow = {
      isDestroyed: () => false,
      webContents: { id: 21 },
      loadURL: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    const args = {
      verifier,
      state,
      windowManager: { controlPanelWindow },
      oauthStateManager: manager,
      appChannel: "development",
      oauthProtocol: "echodraft-dev",
    };

    expect(acceptOAuthCallback(args)).toBe(true);
    expect(controlPanelWindow.loadURL).toHaveBeenCalledWith(
      expect.stringContaining(`neon_auth_session_verifier=${encodeURIComponent(verifier)}`)
    );
    expect(acceptOAuthCallback(args)).toBe(false);

    const otherManager = createOAuthStateManager({ randomBytes: () => Buffer.alloc(32, 7) });
    otherManager.issue({ rendererId: 99 });
    expect(acceptOAuthCallback({ ...args, oauthStateManager: otherManager })).toBe(false);
  });
});
