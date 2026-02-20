import { describe, expect, it } from "vitest";

const { buildWhisperMultipartBody } = require("./multipartBody");

describe("buildWhisperMultipartBody", () => {
  it("builds a multipart body containing audio and optional fields", () => {
    const audioBuffer = Buffer.from([1, 2, 3, 4]);
    const { boundary, body } = buildWhisperMultipartBody({
      audioBuffer,
      language: "en",
      initialPrompt: "Names: EchoDraft",
      boundary: "BOUNDARY",
    });

    expect(boundary).toBe("BOUNDARY");
    expect(body.length).toBeGreaterThan(audioBuffer.length);

    const bodyText = body.toString("utf8");
    expect(bodyText).toContain("--BOUNDARY");
    expect(bodyText).toContain('name="file"');
    expect(bodyText).toContain('name="language"');
    expect(bodyText).toContain("en");
    expect(bodyText).toContain('name="prompt"');
    expect(bodyText).toContain("Names: EchoDraft");
    expect(bodyText).toContain('name="response_format"');
    expect(bodyText).toContain("json");
    expect(bodyText).toContain("--BOUNDARY--");
  });
});

