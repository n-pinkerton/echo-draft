// @vitest-environment node
import net from "net";
import { describe, expect, it } from "vitest";

const { getFreeLoopbackPort } = require("./network");

describe("windowsReleaseGate network helpers", () => {
  it("selects a loopback port that can be rebound", async () => {
    const port = await getFreeLoopbackPort();

    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    });
  });
});
