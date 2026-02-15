import { describe, expect, it } from "vitest";

import {
  UNTRUSTED_TRANSCRIPTION_CLOSE_TAG,
  UNTRUSTED_TRANSCRIPTION_OPEN_TAG,
  getUserPrompt,
  stripUntrustedTranscriptionWrapper,
  wrapUntrustedTranscription,
} from "./prompts";

describe("prompts untrusted transcription wrapper", () => {
  it("wrapUntrustedTranscription wraps raw text in tags", () => {
    const wrapped = wrapUntrustedTranscription("hello world");
    expect(wrapped).toBe(
      `${UNTRUSTED_TRANSCRIPTION_OPEN_TAG}\nhello world\n${UNTRUSTED_TRANSCRIPTION_CLOSE_TAG}`
    );
  });

  it("wrapUntrustedTranscription is idempotent", () => {
    const once = wrapUntrustedTranscription("hello");
    const twice = wrapUntrustedTranscription(once);
    expect(twice).toBe(once);
  });

  it("stripUntrustedTranscriptionWrapper unwraps when tags wrap the entire output", () => {
    const wrapped = `${UNTRUSTED_TRANSCRIPTION_OPEN_TAG}\nhello\n${UNTRUSTED_TRANSCRIPTION_CLOSE_TAG}`;
    expect(stripUntrustedTranscriptionWrapper(wrapped)).toBe("hello");
  });

  it("stripUntrustedTranscriptionWrapper does not strip partial matches", () => {
    const partial = `${UNTRUSTED_TRANSCRIPTION_OPEN_TAG}\nhello`;
    expect(stripUntrustedTranscriptionWrapper(partial)).toBe(partial);

    const mid = `before ${UNTRUSTED_TRANSCRIPTION_OPEN_TAG} hello ${UNTRUSTED_TRANSCRIPTION_CLOSE_TAG} after`;
    expect(stripUntrustedTranscriptionWrapper(mid)).toBe(mid);
  });

  it("getUserPrompt wraps text", () => {
    expect(getUserPrompt("x")).toBe(
      `${UNTRUSTED_TRANSCRIPTION_OPEN_TAG}\nx\n${UNTRUSTED_TRANSCRIPTION_CLOSE_TAG}`
    );
  });
});
