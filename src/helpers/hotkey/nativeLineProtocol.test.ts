import { describe, expect, it, vi } from "vitest";

import protocolModule from "./nativeLineProtocol.js";

const { createNativeLineDecoder } = protocolModule as any;

describe("createNativeLineDecoder", () => {
  it("preserves protocol lines split across stdout chunks", () => {
    const onLine = vi.fn();
    const decoder = createNativeLineDecoder(onLine);

    decoder.push("REA");
    decoder.push("DY\r\nKEY_");
    decoder.push("DOWN\nKEY_UP\n");

    expect(onLine.mock.calls.map(([line]) => line)).toEqual(["READY", "KEY_DOWN", "KEY_UP"]);
  });

  it("emits multiple complete lines and keeps only the unfinished suffix", () => {
    const onLine = vi.fn();
    const decoder = createNativeLineDecoder(onLine);

    decoder.push("READY\nKEY_DOWN\nKEY");
    expect(onLine.mock.calls.map(([line]) => line)).toEqual(["READY", "KEY_DOWN"]);

    decoder.push("_UP\n");
    expect(onLine.mock.calls.map(([line]) => line)).toEqual(["READY", "KEY_DOWN", "KEY_UP"]);
  });

  it("discards an overlong unterminated line", () => {
    const onLine = vi.fn();
    const onOverflow = vi.fn();
    const decoder = createNativeLineDecoder(onLine, { maxBufferLength: 8, onOverflow });

    decoder.push("123456789");
    decoder.push("READY\n");

    expect(onOverflow).toHaveBeenCalledWith(9);
    expect(onLine).toHaveBeenCalledWith("READY");
  });
});
