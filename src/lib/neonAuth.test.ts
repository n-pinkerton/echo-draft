import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearLastSignInTime, updateLastSignInTime, withSessionRefresh } from "./neonAuth";

vi.mock("@neondatabase/auth", () => ({
  createAuthClient: () => ({
    getSession: vi.fn(),
    signIn: { social: vi.fn() },
    signOut: vi.fn(),
  }),
}));
vi.mock("@neondatabase/auth/react", () => ({ BetterAuthReactAdapter: vi.fn() }));
vi.mock("../utils/externalLinks", () => ({ openExternalLink: vi.fn() }));

describe("withSessionRefresh cancellation", () => {
  beforeEach(() => {
    localStorage.clear();
    clearLastSignInTime();
  });

  it("cancels an auth grace-period wait before retrying the operation", async () => {
    updateLastSignInTime();
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      throw Object.assign(new Error("Session expired"), { code: "AUTH_EXPIRED" });
    });

    const pending = withSessionRefresh(operation, { signal: controller.signal });
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledOnce();
  });
});

describe("Electron social sign-in initiation", () => {
  const oauthState = "a".repeat(43);

  const loadSubject = async (overrides: Record<string, unknown> = {}) => {
    vi.resetModules();
    vi.stubEnv("VITE_NEON_AUTH_URL", "https://auth.example.test");
    const authBeginSocialSignIn = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        beginOAuthSession: vi.fn().mockResolvedValue({ state: oauthState }),
        authBeginSocialSignIn,
        ...overrides,
      },
    });
    const subject = await import("./neonAuth");
    return { subject, authBeginSocialSignIn };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("delegates Electron sign-in to the bounded main-process transport", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { subject, authBeginSocialSignIn } = await loadSubject();

    await expect(subject.signInWithSocial("google")).resolves.toEqual({});
    expect(authBeginSocialSignIn).toHaveBeenCalledWith("google", oauthState);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces only the main-process public failure", async () => {
    const authBeginSocialSignIn = vi
      .fn()
      .mockResolvedValue({ success: false, error: "Unexpected response from auth server" });
    const { subject } = await loadSubject({ authBeginSocialSignIn });

    await expect(subject.signInWithSocial("google")).resolves.toMatchObject({
      error: { message: "Unexpected response from auth server" },
    });
  });
});
