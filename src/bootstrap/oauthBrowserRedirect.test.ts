import { describe, expect, it } from "vitest";
import { handleOAuthBrowserRedirect, resolveOAuthRedirectConfig } from "./oauthBrowserRedirect";

describe("oauthBrowserRedirect", () => {
  it("resolves a protocol config without throwing", () => {
    const config = resolveOAuthRedirectConfig();
    expect(typeof config.protocol).toBe("string");
    expect(config.protocol.length).toBeGreaterThan(0);
  });

  it("returns false when there is no verifier in the querystring", () => {
    window.history.pushState({}, "", "/");
    expect(handleOAuthBrowserRedirect()).toBe(false);
  });

  it("returns false when running inside Electron (window.electronAPI defined)", () => {
    const original = (window as any).electronAPI;
    (window as any).electronAPI = {};
    window.history.pushState({}, "", "/?neon_auth_session_verifier=test");
    try {
      expect(handleOAuthBrowserRedirect()).toBe(false);
    } finally {
      (window as any).electronAPI = original;
    }
  });
});

