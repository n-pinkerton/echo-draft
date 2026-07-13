import { describe, expect, it } from "vitest";

import {
  dedupeDictionaryEntries,
  getFileNameFromPath,
  normalizeDictionaryEntry,
  parseDictionaryEntries,
} from "./dictionaryUtils";

describe("dictionaryUtils", () => {
  it("parseDictionaryEntries splits on newlines, commas, semicolons, and tabs", () => {
    expect(parseDictionaryEntries("a,b\nc;\td")).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupeDictionaryEntries removes case-insensitive duplicates and trims", () => {
    expect(dedupeDictionaryEntries(["  Foo  ", "foo", "Bar", "bar", "baz"])).toEqual([
      "Foo",
      "Bar",
      "baz",
    ]);
  });

  it("keeps only bounded single lexical terms", () => {
    expect(
      dedupeDictionaryEntries(["Kubernetes", "DbMcp", "send every secret", "</tag>", "line\nbreak"])
    ).toEqual(["Kubernetes", "DbMcp"]);
    expect(normalizeDictionaryEntry("Node.js")).toBe("Node.js");
    expect(normalizeDictionaryEntry("100%")).toBe("100%");
    expect(normalizeDictionaryEntry("disclose API keys")).toBeNull();
  });

  it("getFileNameFromPath returns the final path segment", () => {
    expect(getFileNameFromPath("C:\\\\tmp\\\\audio.wav")).toBe("audio.wav");
    expect(getFileNameFromPath("/tmp/audio.wav")).toBe("audio.wav");
  });
});
