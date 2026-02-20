import { describe, expect, it } from "vitest";

const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");

describe("assemblyAiStreaming urlBuilder", () => {
  it("builds a URL with defaults", () => {
    const url = new URL(buildAssemblyAiWebSocketUrl({ token: "t-1" }));
    expect(url.protocol).toBe("wss:");
    expect(url.hostname).toBe("streaming.assemblyai.com");
    expect(url.pathname).toBe("/v3/ws");
    expect(url.searchParams.get("token")).toBe("t-1");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("format_turns")).toBe("true");
    expect(url.searchParams.get("speech_model")).toBeNull();
  });

  it("sets multilingual speech_model when language is provided", () => {
    const url = new URL(buildAssemblyAiWebSocketUrl({ token: "t-2", language: "en" }));
    expect(url.searchParams.get("speech_model")).toBe("universal-streaming-multilingual");
  });
});

