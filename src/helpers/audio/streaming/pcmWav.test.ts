import { describe, expect, it } from "vitest";

import { createPcmWavBlob } from "./pcmWav";

describe("pcmWav", () => {
  it("creates a mono PCM WAV containing every streamed chunk", async () => {
    const first = new Int16Array([1, -2]).buffer;
    const second = new Int16Array([3]).buffer;

    const blob = createPcmWavBlob([first, second], 16_000);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe("audio/wav");
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16_000);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(6);
    expect(Array.from(bytes.slice(44))).toEqual(Array.from(new Uint8Array([1, 0, 254, 255, 3, 0])));
  });

  it("returns no capture for an empty stream", () => {
    expect(createPcmWavBlob([])).toBeNull();
  });
});
