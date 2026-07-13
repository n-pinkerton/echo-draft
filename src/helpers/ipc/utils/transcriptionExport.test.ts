import { describe, expect, it } from "vitest";

import exportUtils from "./transcriptionExport.js";

const { flattenTranscriptionRow, serializeTranscriptionCsv } = exportUtils as any;

describe("transcription export utilities", () => {
  it("includes truthful clipboard and delivery diagnostics in production and E2E rows", () => {
    const row = flattenTranscriptionRow({
      id: 7,
      timestamp: "2026-07-12T00:00:00.000Z",
      text: "Finished text",
      raw_text: "Raw text",
      meta: {
        outputMode: "insert",
        status: "delivery_issue",
        pasteSucceeded: false,
        clipboardSucceeded: true,
        delivery: { status: "clipboard_fallback" },
      },
    });

    expect(row).toMatchObject({
      id: 7,
      status: "delivery_issue",
      pasteSucceeded: "false",
      clipboardSucceeded: "true",
      deliveryStatus: "clipboard_fallback",
    });
    const csv = serializeTranscriptionCsv([row]);
    expect(csv.split("\n")[0]).toContain("clipboardSucceeded");
    expect(csv.split("\n")[0]).toContain("deliveryStatus");
    expect(csv).toContain("clipboard_fallback");
  });
});
