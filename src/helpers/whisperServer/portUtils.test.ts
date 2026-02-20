import net from "net";
import { describe, expect, it } from "vitest";

const { isPortAvailable } = require("./portUtils");

describe("portUtils", () => {
  it("detects ports in use", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Unexpected server address");
    }

    expect(await isPortAvailable(address.port)).toBe(false);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortAvailable(address.port)).toBe(true);
  });
});

