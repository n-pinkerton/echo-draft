import { describe, expect, it } from "vitest";

import { MAX_TODO_META_BYTES, MAX_TODO_TEXT_LENGTH, normalizeTodoPayload } from "./todoPayload.js";

const EXTERNAL_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("To Do payload normalization", () => {
  it("normalizes a valid phone result and fingerprints its content", () => {
    const result = normalizeTodoPayload({
      externalId: EXTERNAL_ID.toUpperCase(),
      text: "Follow up with Sam.",
      rawText: "follow up with sam",
      meta: { source: "android" },
    });

    expect(result).toMatchObject({
      externalId: EXTERNAL_ID,
      text: "Follow up with Sam.",
      rawText: "follow up with sam",
      metaJson: '{"source":"android"}',
    });
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      normalizeTodoPayload({
        externalId: EXTERNAL_ID,
        text: "Follow up with Sam.",
        rawText: "follow up with sam",
        meta: { source: "android" },
      }).payloadHash
    ).toBe(result.payloadHash);
  });

  it("deduplicates reordered metadata while preserving array order", () => {
    const first = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { nested: { beta: 2, alpha: 1 }, steps: ["first", "second"] },
    });
    const reordered = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { steps: ["first", "second"], nested: { alpha: 1, beta: 2 } },
    });
    const reorderedArray = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { nested: { alpha: 1, beta: 2 }, steps: ["second", "first"] },
    });

    expect(reordered.payloadHash).toBe(first.payloadHash);
    expect(reorderedArray.payloadHash).not.toBe(first.payloadHash);
  });

  it.each([
    ["missing payload", null],
    ["invalid external ID", { externalId: "phone-1", text: "Memo" }],
    ["blank text", { externalId: EXTERNAL_ID, text: "   " }],
    ["array metadata", { externalId: EXTERNAL_ID, text: "Memo", meta: [] }],
  ])("rejects %s", (_label, payload) => {
    expect(() => normalizeTodoPayload(payload)).toThrow();
  });

  it("rejects oversized text and metadata", () => {
    expect(() =>
      normalizeTodoPayload({ externalId: EXTERNAL_ID, text: "x".repeat(MAX_TODO_TEXT_LENGTH + 1) })
    ).toThrow(/text/i);
    expect(() =>
      normalizeTodoPayload({
        externalId: EXTERNAL_ID,
        text: "Memo",
        meta: { value: "x".repeat(MAX_TODO_META_BYTES) },
      })
    ).toThrow(/metadata/i);
  });
});
