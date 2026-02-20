import { describe, expect, it } from "vitest";

const { coerceAudioBlobToBuffer } = require("./audioBufferUtils");

describe("coerceAudioBlobToBuffer", () => {
  it("accepts Buffer", () => {
    const input = Buffer.from([1, 2, 3]);
    const out = coerceAudioBlobToBuffer(input);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.equals(input)).toBe(true);
  });

  it("accepts ArrayBuffer", () => {
    const input = new Uint8Array([4, 5, 6]).buffer;
    const out = coerceAudioBlobToBuffer(input);
    expect(Array.from(out)).toEqual([4, 5, 6]);
  });

  it("accepts TypedArray view", () => {
    const input = new Uint8Array([7, 8, 9]);
    const out = coerceAudioBlobToBuffer(input);
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });

  it("accepts base64 string", () => {
    const input = Buffer.from("hello").toString("base64");
    const out = coerceAudioBlobToBuffer(input);
    expect(out.toString("utf8")).toBe("hello");
  });

  it("throws on empty buffer", () => {
    expect(() => coerceAudioBlobToBuffer(Buffer.alloc(0))).toThrow(/empty/i);
  });
});

