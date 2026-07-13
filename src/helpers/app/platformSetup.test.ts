import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { configureChannelUserDataPath } = require("./platformSetup");

const createApp = () => ({
  getPath: vi.fn((name: string) => {
    if (name === "appData") return "C:\\Users\\Tester\\AppData\\Roaming";
    throw new Error(`Unexpected path: ${name}`);
  }),
  setPath: vi.fn(),
});

describe("configureChannelUserDataPath", () => {
  it("keeps the normal production profile for a non-E2E launch", () => {
    const app = createApp();

    configureChannelUserDataPath({ app, channel: "production", env: {} });

    expect(app.setPath).not.toHaveBeenCalled();
  });

  it("isolates an E2E launch even when the inherited channel says production", () => {
    const app = createApp();

    configureChannelUserDataPath({
      app,
      channel: "production",
      env: { OPENWHISPR_E2E: "1", OPENWHISPR_E2E_RUN_ID: "run-123" },
    });

    expect(app.setPath).toHaveBeenCalledWith(
      "userData",
      path.join("C:\\Users\\Tester\\AppData\\Roaming", "EchoDraft-production-e2e-run-123")
    );
  });
});
