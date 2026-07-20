export const CLIPBOARD_PROTECTION_FAILURE_CODES = new Set([
  "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
  "WINDOWS_CLIPBOARD_RESTORE_PENDING",
]);

export const planPasteDeliveryOutcome = (pasteResult = {}) => {
  const pasteSucceeded = pasteResult?.success === true;
  const insertionMayHaveOccurred = Boolean(
    !pasteSucceeded && pasteResult?.insertionMayHaveOccurred === true
  );
  const clipboardRestoreWarning = Boolean(
    pasteSucceeded && pasteResult?.inserted === true && pasteResult?.clipboardRestored === false
  );
  const transcriptAlreadyInClipboard = pasteResult?.clipboardRetained === true;
  const clipboardChangedAfterPaste = Boolean(
    !pasteSucceeded && pasteResult?.clipboardWriteCommitted === true && !transcriptAlreadyInClipboard
  );

  let deliveryStatus = "clipboard_fallback_pending";
  if (clipboardRestoreWarning) deliveryStatus = "inserted_clipboard_warning";
  else if (pasteSucceeded) deliveryStatus = "inserted";
  else if (insertionMayHaveOccurred) deliveryStatus = "insert_uncertain";
  else if (CLIPBOARD_PROTECTION_FAILURE_CODES.has(pasteResult?.errorCode)) {
    deliveryStatus = "clipboard_protected";
  } else if (transcriptAlreadyInClipboard) {
    deliveryStatus = "clipboard_fallback";
  } else if (clipboardChangedAfterPaste) {
    deliveryStatus = "clipboard_changed";
  }

  return {
    pasteSucceeded,
    insertionMayHaveOccurred,
    clipboardRestoreWarning,
    transcriptAlreadyInClipboard,
    clipboardChangedAfterPaste,
    deliveryReasonCode: clipboardRestoreWarning
      ? pasteResult?.warningCode || "WINDOWS_CLIPBOARD_RESTORE_FAILED"
      : pasteSucceeded
        ? null
        : pasteResult?.errorCode || "AUTOMATIC_INSERTION_FAILED",
    deliveryStatus,
    needsClipboardFallback: deliveryStatus === "clipboard_fallback_pending",
  };
};

export const getHistoryStatus = (deliveryStatus) =>
  ["inserted", "clipboard"].includes(deliveryStatus) ? "success" : "delivery_issue";

export const isDeliverySucceeded = (deliveryStatus) =>
  ["inserted", "inserted_clipboard_warning", "clipboard", "clipboard_fallback"].includes(
    deliveryStatus
  );
