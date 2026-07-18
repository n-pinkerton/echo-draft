import { describe, expect, it } from "vitest";

import { MAX_TODO_META_BYTES, MAX_TODO_TEXT_LENGTH, normalizeTodoPayload } from "./todoPayload.js";

const EXTERNAL_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("To Do payload normalization", () => {
  it("normalizes a valid phone result and fingerprints its content", () => {
    const result = normalizeTodoPayload({
      externalId: EXTERNAL_ID.toUpperCase(),
      title: "Follow up with Sam",
      text: "Follow up with Sam.",
      rawText: "follow up with sam",
      meta: { source: "android" },
    });

    expect(result).toMatchObject({
      externalId: EXTERNAL_ID,
      title: "Follow up with Sam",
      text: "Follow up with Sam.",
      rawText: "follow up with sam",
      metaJson: '{"source":"android","title":"Follow up with Sam"}',
    });
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      normalizeTodoPayload({
        externalId: EXTERNAL_ID,
        title: "Follow up with Sam",
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

  it("fingerprints the JSON representation persisted for metadata", () => {
    const first = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { capturedAt: new Date("2026-07-18T01:00:00.000Z") },
    });
    const second = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { capturedAt: new Date("2026-07-18T02:00:00.000Z") },
    });

    expect(first.metaJson).toContain("2026-07-18T01:00:00.000Z");
    expect(second.payloadHash).not.toBe(first.payloadHash);
  });

  it.each([
    ["missing payload", null],
    ["invalid external ID", { externalId: "phone-1", text: "Memo" }],
    ["blank text", { externalId: EXTERNAL_ID, text: "   " }],
    ["blank title", { externalId: EXTERNAL_ID, title: "   ", text: "Memo" }],
    ["oversized title", { externalId: EXTERNAL_ID, title: "x".repeat(101), text: "Memo" }],
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

  it("treats the title as core payload data instead of trusting metadata", () => {
    const titled = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      title: "Trusted title",
      text: "Memo",
      meta: { title: "Injected metadata title", source: "android" },
    });
    const untitled = normalizeTodoPayload({
      externalId: EXTERNAL_ID,
      text: "Memo",
      meta: { title: "Injected metadata title", source: "android" },
    });

    expect(titled.title).toBe("Trusted title");
    expect(titled.metaJson).toBe('{"source":"android","title":"Trusted title"}');
    expect(untitled.title).toBeNull();
    expect(untitled.metaJson).toBe('{"source":"android"}');
    expect(titled.payloadHash).not.toBe(untitled.payloadHash);
  });
});
