import { describe, expect, it } from "vitest";
import {
  getHistoryStatus,
  isDeliverySucceeded,
  planPasteDeliveryOutcome,
} from "./transcriptionDeliveryPolicy";

describe("transcription delivery policy", () => {
  it.each([
    [{ success: true }, "inserted"],
    [{ success: true, inserted: true, clipboardRestored: false }, "inserted_clipboard_warning"],
    [{ success: false, insertionMayHaveOccurred: true }, "insert_uncertain"],
    [{ success: false, errorCode: "WINDOWS_CLIPBOARD_RESTORE_PENDING" }, "clipboard_protected"],
    [{ success: false, clipboardRetained: true }, "clipboard_fallback"],
    [{ success: false, clipboardWriteCommitted: true }, "clipboard_changed"],
    [{ success: false, errorCode: "AUTOMATIC_INSERTION_FAILED" }, "clipboard_fallback_pending"],
  ])("plans %s as %s", (pasteResult, expectedStatus) => {
    expect(planPasteDeliveryOutcome(pasteResult)).toMatchObject({
      deliveryStatus: expectedStatus,
      pasteSucceeded: pasteResult.success === true,
    });
  });

  it("preserves the protected clipboard signal and avoids fallback", () => {
    expect(
      planPasteDeliveryOutcome({
        success: false,
        errorCode: "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
      })
    ).toMatchObject({
      deliveryStatus: "clipboard_protected",
      needsClipboardFallback: false,
      deliveryReasonCode: "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
    });
  });

  it("does not invent a failure reason for a confirmed paste", () => {
    expect(planPasteDeliveryOutcome({ success: true }).deliveryReasonCode).toBeNull();
  });

  it.each([
    ["inserted", "success", true],
    ["clipboard", "success", true],
    ["clipboard_fallback", "delivery_issue", true],
    ["failed", "delivery_issue", false],
  ])("maps %s history and terminal delivery status", (status, historyStatus, succeeded) => {
    expect(getHistoryStatus(status)).toBe(historyStatus);
    expect(isDeliverySucceeded(status)).toBe(succeeded);
  });
});
