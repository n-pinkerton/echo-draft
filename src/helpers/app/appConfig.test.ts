// @vitest-environment node
import { describe, expect, it } from "vitest";

const {
  inferDefaultChannel,
  getOAuthProtocol,
  parseAuthBridgePort,
  resolveAppChannel,
  shouldRegisterProtocolWithAppArg,
} = require("./appConfig");

describe("appConfig", () => {
  describe("resolveAppChannel", () => {
    it("uses explicit valid channel from env", () => {
      expect(resolveAppChannel({ env: { OPENWHISPR_CHANNEL: "staging" } })).toBe("staging");
      expect(resolveAppChannel({ env: { VITE_OPENWHISPR_CHANNEL: "production" } })).toBe(
        "production"
      );
    });

    it("falls back to inferred default channel", () => {
      expect(
        resolveAppChannel({
          env: { OPENWHISPR_CHANNEL: "invalid" },
          nodeEnv: "production",
          defaultApp: false,
          execPath: "/usr/bin/node",
        })
      ).toBe("production");

      expect(
        resolveAppChannel({
          env: { OPENWHISPR_CHANNEL: "" },
          nodeEnv: "development",
          defaultApp: false,
          execPath: "/usr/bin/node",
        })
      ).toBe("development");
    });
  });

  describe("inferDefaultChannel", () => {
    it("treats Electron binary exec as development", () => {
      expect(
        inferDefaultChannel({
          nodeEnv: "production",
          defaultApp: false,
          execPath: "C:\\\\tools\\\\electron.exe",
        })
      ).toBe("development");
    });
  });

  describe("getOAuthProtocol", () => {
    it("returns validated protocol from env when present", () => {
      expect(getOAuthProtocol({ env: { OPENWHISPR_PROTOCOL: "openwhispr-dev" }, channel: "production" })).toBe(
        "openwhispr-dev"
      );
    });

    it("falls back to channel defaults when env is missing/invalid", () => {
      expect(getOAuthProtocol({ env: {}, channel: "development" })).toBe("openwhispr-dev");
      expect(getOAuthProtocol({ env: { OPENWHISPR_PROTOCOL: "not a protocol" }, channel: "staging" })).toBe(
        "openwhispr-staging"
      );
    });
  });

  describe("parseAuthBridgePort", () => {
    it("returns the default when env is empty/invalid", () => {
      expect(parseAuthBridgePort({ env: {} })).toBe(5199);
      expect(parseAuthBridgePort({ env: { OPENWHISPR_AUTH_BRIDGE_PORT: "0" } })).toBe(5199);
      expect(parseAuthBridgePort({ env: { OPENWHISPR_AUTH_BRIDGE_PORT: "99999" } })).toBe(5199);
      expect(parseAuthBridgePort({ env: { OPENWHISPR_AUTH_BRIDGE_PORT: "abc" } })).toBe(5199);
    });

    it("parses a valid port from env", () => {
      expect(parseAuthBridgePort({ env: { OPENWHISPR_AUTH_BRIDGE_PORT: "5200" } })).toBe(5200);
    });
  });

  describe("shouldRegisterProtocolWithAppArg", () => {
    it("returns true for defaultApp or electron binary exec", () => {
      expect(shouldRegisterProtocolWithAppArg({ defaultApp: true, execPath: "/usr/bin/node" })).toBe(
        true
      );
      expect(
        shouldRegisterProtocolWithAppArg({ defaultApp: false, execPath: "C:\\\\electron.exe" })
      ).toBe(true);
    });

    it("returns false for packaged app exec paths", () => {
      expect(
        shouldRegisterProtocolWithAppArg({ defaultApp: false, execPath: "C:\\\\Program Files\\\\EchoDraft\\\\EchoDraft.exe" })
      ).toBe(false);
    });
  });
});
