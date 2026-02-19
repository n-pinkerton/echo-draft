import { describe, expect, it } from "vitest";

import { filterHistory, getProviderOptions } from "./historyFilterUtils";

describe("historyFilterUtils", () => {
  const history: any[] = [
    {
      id: 1,
      text: "Hello world",
      raw_text: "Hello world",
      meta: { provider: "openai", model: "gpt-4o-mini", outputMode: "insert", status: "success" },
    },
    {
      id: 2,
      text: "Clipboard text",
      raw_text: "Clipboard text",
      meta: { source: "openwhispr", outputMode: "clipboard", status: "success" },
    },
    {
      id: 3,
      text: "Error result",
      raw_text: "Error result",
      meta: { provider: "openai", outputMode: "insert", status: "error" },
    },
  ];

  it("collects provider options from provider/source", () => {
    expect(getProviderOptions(history as any)).toEqual(["openai", "openwhispr"]);
  });

  it("filters by query and mode/status/provider", () => {
    expect(
      filterHistory(history as any, {
        searchQuery: "hello",
        modeFilter: "all",
        statusFilter: "all",
        providerFilter: "all",
      }).map((x: any) => x.id)
    ).toEqual([1]);

    expect(
      filterHistory(history as any, {
        searchQuery: "",
        modeFilter: "clipboard",
        statusFilter: "all",
        providerFilter: "all",
      }).map((x: any) => x.id)
    ).toEqual([2]);

    expect(
      filterHistory(history as any, {
        searchQuery: "",
        modeFilter: "all",
        statusFilter: "error",
        providerFilter: "all",
      }).map((x: any) => x.id)
    ).toEqual([3]);

    expect(
      filterHistory(history as any, {
        searchQuery: "",
        modeFilter: "all",
        statusFilter: "all",
        providerFilter: "openwhispr",
      }).map((x: any) => x.id)
    ).toEqual([2]);
  });
});

