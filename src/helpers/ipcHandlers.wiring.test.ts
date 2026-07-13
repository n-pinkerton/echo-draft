import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("production IPC wiring", () => {
  it("passes the shared cancellation registry into secure provider transport", () => {
    const source = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ipcHandlers.js"),
      "utf8"
    );
    expect(source).toMatch(
      /registerProviderRequestHandlers\([\s\S]*?cancelableRequests:\s*this\.cancelableRequests[\s\S]*?environmentManager:\s*this\.environmentManager/
    );
  });
});
