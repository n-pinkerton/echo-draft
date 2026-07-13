// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAuthHandlers } from "./authHandlers.js";

const debugLogger = require("../../debugLogger.js");

const oauthState = "a".repeat(43);

const createHarness = (response: Response) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  };
  const fetch = vi.fn().mockResolvedValue(response);
  const sender: any = {
    id: 21,
    getURL: () => "file:///app/index.html?view=control-panel",
    session: { fetch },
  };
  sender.mainFrame = { url: sender.getURL() };
  const windowManager = {
    controlPanelWindow: {
      __echoDraftTrustedUrl: sender.getURL(),
      webContents: sender,
      isDestroyed: () => false,
    },
  };
  const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
  const cloudContext = {
    getAuthUrl: vi.fn(() => "https://auth.example.test/neondb/auth"),
    clearAuthSessionCookies: vi.fn(),
    runtimeEnv: { VITE_DEV_SERVER_PORT: "5183" },
  };
  registerAuthHandlers({ ipcMain, shell } as any, { cloudContext, windowManager } as any);
  const event = { sender, senderFrame: sender.mainFrame };
  return { cloudContext, event, fetch, handlers, shell };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("main-process social sign-in transport", () => {
  it("posts only to the fixed auth endpoint and opens a strict HTTPS authorization URL", async () => {
    vi.stubEnv("OPENWHISPR_OAUTH_CALLBACK_URL", "");
    vi.stubEnv("VITE_OPENWHISPR_OAUTH_CALLBACK_URL", "");
    const harness = createHarness(
      new Response('{"url":"https://accounts.example.test/authorize?state=public"}', {
        status: 200,
      })
    );

    const result = await harness.handlers.get("auth-begin-social-sign-in")?.(
      harness.event,
      { provider: "google", state: oauthState, url: "https://attacker.invalid" }
    );

    expect(result).toEqual({ success: true });
    expect(harness.fetch).toHaveBeenCalledOnce();
    const [requestUrl, options] = harness.fetch.mock.calls[0];
    expect(requestUrl).toBe("https://auth.example.test/neondb/auth/sign-in/social");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "manual",
      credentials: "include",
    });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ provider: "google", disableRedirect: true });
    expect(new URL(body.callbackURL).searchParams.get("oauth_state")).toBe(oauthState);
    expect(body.callbackURL).not.toContain("attacker.invalid");
    expect(harness.shell.openExternal).toHaveBeenCalledWith(
      "https://accounts.example.test/authorize?state=public"
    );
  });

  it("does not follow or consume redirects", async () => {
    const marker = "SENSITIVE_REDIRECT_BODY_MARKER";
    const harness = createHarness(
      new Response(marker, { status: 302, headers: { location: "https://attacker.invalid" } })
    );

    await expect(
      harness.handlers.get("auth-begin-social-sign-in")?.(harness.event, {
        provider: "google",
        state: oauthState,
      })
    ).resolves.toEqual({ success: false, error: "Failed to initiate sign-in" });
    expect(harness.fetch.mock.calls[0][1].redirect).toBe("manual");
    expect(harness.shell.openExternal).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked response before parsing or opening it", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
        controller.close();
      },
    });
    const harness = createHarness(new Response(body, { status: 200 }));

    await expect(
      harness.handlers.get("auth-begin-social-sign-in")?.(harness.event, {
        provider: "google",
        state: oauthState,
      })
    ).resolves.toEqual({ success: false, error: "Unexpected response from auth server" });
    expect(harness.shell.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    '{"url":"https://accounts.example.test","extra":true}',
    '{"url":42}',
    '{"url":"http://accounts.example.test"}',
    '{"url":"https://user:secret@accounts.example.test"}',
    "not-json",
  ])("rejects malformed provider data without opening it", async (body) => {
    const harness = createHarness(new Response(body, { status: 200 }));

    const result = await harness.handlers.get("auth-begin-social-sign-in")?.(harness.event, {
      provider: "google",
      state: oauthState,
    });

    expect(result).toEqual({ success: false, error: "Unexpected response from auth server" });
    expect(harness.shell.openExternal).not.toHaveBeenCalled();
  });

  it("never includes a provider response body in main-process diagnostics", async () => {
    const marker = "SENSITIVE_PROVIDER_BODY_MARKER";
    const log = vi.spyOn(debugLogger, "error").mockImplementation(() => undefined);
    const harness = createHarness(new Response(marker, { status: 500 }));

    await harness.handlers.get("auth-begin-social-sign-in")?.(harness.event, {
      provider: "google",
      state: oauthState,
    });

    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
    expect(log.mock.calls[0][1]).toEqual({ status: 500, category: "http_status" });
  });
});
