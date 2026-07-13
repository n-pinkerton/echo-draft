import { describe, expect, it } from "vitest";

const { normalizeExternalHttpsUrl } = require("./externalUrl");

describe("normalizeExternalHttpsUrl", () => {
  it("allows a bounded HTTPS URL", () => {
    expect(normalizeExternalHttpsUrl("https://example.com/help?q=1")).toBe(
      "https://example.com/help?q=1"
    );
  });

  it.each([
    "http://example.com",
    "file:///C:/secret.txt",
    "javascript:alert(1)",
    "data:text/plain,test",
    "ms-settings:privacy-microphone",
    "my-app://open",
    "https://user:secret@example.com",
    `https://example.com/${"x".repeat(2100)}`,
    "https://example.com/\nnext",
  ])("rejects unsafe external URL %s", (value) => {
    expect(() => normalizeExternalHttpsUrl(value)).toThrow();
  });
});
