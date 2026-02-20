import { describe, expect, it } from "vitest";

import { dedupeDictionaryEntries, getFileNameFromPath, parseDictionaryEntries } from "./dictionaryUtils";

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

  it("getFileNameFromPath returns the final path segment", () => {
    expect(getFileNameFromPath("C:\\\\tmp\\\\audio.wav")).toBe("audio.wav");
    expect(getFileNameFromPath("/tmp/audio.wav")).toBe("audio.wav");
  });
});

