import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCloudRequestUrl,
  createCloudContext,
  normalizeConfiguredHttpsUrl,
} from "./cloudContext.js";

const originalApiUrl = process.env.OPENWHISPR_API_URL;
const originalAuthUrl = process.env.NEON_AUTH_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.OPENWHISPR_API_URL;
  else process.env.OPENWHISPR_API_URL = originalApiUrl;
  if (originalAuthUrl === undefined) delete process.env.NEON_AUTH_URL;
  else process.env.NEON_AUTH_URL = originalAuthUrl;
});

function createContext(get = vi.fn(async (_filter: { url?: string }) => []), remove = vi.fn()) {
  const cookies = { get, remove };
  const sender = { session: { cookies } };
  return {
    context: createCloudContext({
      helpersDir: "C:/app/src/helpers",
      fs: { existsSync: () => false },
      path: { join: (...parts: string[]) => parts.join("/") },
      BrowserWindow: { fromWebContents: () => ({ webContents: sender }) },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
    }),
    get,
    remove,
  };
}

describe("cloud URL boundary", () => {
  it("accepts only credential-free HTTPS configuration", () => {
    expect(normalizeConfiguredHttpsUrl(" https://api.example.test/base/ ")).toBe(
      "https://api.example.test/base"
    );
    expect(() => normalizeConfiguredHttpsUrl("http://api.example.test")).toThrow(
      "credential-free HTTPS"
    );
    expect(() => normalizeConfiguredHttpsUrl("https://user:secret@api.example.test")).toThrow(
      "credential-free HTTPS"
    );
    expect(() => normalizeConfiguredHttpsUrl("https://api.example.test?next=evil")).toThrow(
      "credential-free HTTPS"
    );
  });

  it("builds endpoints beneath a configured base path", () => {
    expect(buildCloudRequestUrl("https://api.example.test/base", "/api/reason")).toBe(
      "https://api.example.test/base/api/reason"
    );
    expect(() => buildCloudRequestUrl("https://api.example.test", "//evil.test/path")).toThrow(
      "endpoint is invalid"
    );
  });
});

describe("createCloudContext", () => {
  it("forwards only allowlisted session cookies scoped to the exact API request", async () => {
    process.env.OPENWHISPR_API_URL = "https://api.example.test";
    process.env.NEON_AUTH_URL = "https://auth.example.test";
    const get = vi.fn(async () => [
      { name: "__Secure-neon-auth.session_token", value: "signed.token" },
      { name: "unrelated-preference", value: "private" },
    ]);
    const { context } = createContext(get);

    await expect(
      context.getSessionCookies({}, "https://api.example.test/api/reason")
    ).resolves.toBe("__Secure-neon-auth.session_token=signed.token");
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith({ url: "https://api.example.test/api/reason" });
  });

  it("rejects a different origin before reading cookies", async () => {
    process.env.OPENWHISPR_API_URL = "https://api.example.test";
    const { context, get } = createContext();

    await expect(
      context.getSessionCookies({}, "https://other.example.test/api/reason")
    ).rejects.toThrow("outside the configured API boundary");
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects ambiguous duplicate session-cookie names", async () => {
    process.env.OPENWHISPR_API_URL = "https://api.example.test";
    const { context } = createContext(
      vi.fn(async () => [
        { name: "__Secure-neon-auth.session_token", value: "first.token" },
        { name: "__Secure-neon-auth.session_token", value: "second.token" },
      ])
    );

    await expect(
      context.getSessionCookies({}, "https://api.example.test/api/usage")
    ).rejects.toThrow("Ambiguous cloud authentication cookies");
  });

  it("clears only allowlisted auth cookies without clearing unrelated storage", async () => {
    process.env.OPENWHISPR_API_URL = "https://api.example.test";
    process.env.NEON_AUTH_URL = "https://auth.example.test";
    const get = vi.fn(async ({ url }: { url?: string }) => [
      { name: "__Secure-neon-auth.session_token", value: `${url}.token` },
      { name: "unrelated-preference", value: "keep-me" },
    ]);
    const remove = vi.fn(async () => undefined);
    const { context } = createContext(get, remove);

    await expect(context.clearAuthSessionCookies({})).resolves.toBe(2);
    expect(remove.mock.calls).toEqual([
      ["https://auth.example.test", "__Secure-neon-auth.session_token"],
      ["https://api.example.test", "__Secure-neon-auth.session_token"],
    ]);
  });
});
