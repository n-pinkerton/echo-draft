import { describe, expect, it } from "vitest";

const {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
} = require("./dictionaryUtils");

describe("dictionaryUtils", () => {
  it("parseDictionaryWords splits on newlines/commas/tabs/semicolons", () => {
    expect(parseDictionaryWords("Foo, Bar\nBaz;\tQux")).toEqual(["Foo", "Bar", "Baz", "Qux"]);
  });

  it("dedupeDictionaryWords trims and dedupes case-insensitively", () => {
    expect(dedupeDictionaryWords([" Foo ", "foo", "BAR", "bar", "", "  "])).toEqual(["Foo", "BAR"]);
  });

  it("stripDictionaryHeader removes leading csv/tsv header", () => {
    expect(stripDictionaryHeader(["word", "Foo"], "dict.csv")).toEqual(["Foo"]);
    expect(stripDictionaryHeader(["WORD", "Foo"], "dict.tsv")).toEqual(["Foo"]);
    expect(stripDictionaryHeader(["word"], "dict.csv")).toEqual(["word"]);
  });

  it("stripDictionaryHeader does nothing for non-csv extensions", () => {
    expect(stripDictionaryHeader(["word", "Foo"], "dict.txt")).toEqual(["word", "Foo"]);
  });
});

