import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DictionaryBatchPanel from "./DictionaryBatchPanel";

const renderPanel = (preview: {
  parsedCount: number;
  uniqueWordsCount: number;
  duplicatesRemoved: number;
  invalidEntriesRemoved: number;
}) =>
  render(
    <DictionaryBatchPanel
      customDictionaryLength={2}
      dictionaryBatchText="EchoDraft"
      onDictionaryBatchTextChange={vi.fn()}
      dictionaryImportMode="merge"
      onDictionaryImportModeChange={vi.fn()}
      onClearDraft={vi.fn()}
      onApplyBatch={vi.fn()}
      preview={preview}
      importedDictionaryFileName=""
      isImportingDictionaryFile={false}
      onImportDictionaryFile={vi.fn()}
      isExportingDictionary={false}
      onExportDictionary={vi.fn()}
    />
  );

describe("DictionaryBatchPanel", () => {
  it("shows grammatical preview counts and stable machine-readable evidence", () => {
    renderPanel({
      parsedCount: 5,
      uniqueWordsCount: 3,
      duplicatesRemoved: 1,
      invalidEntriesRemoved: 1,
    });

    const preview = screen.getByTestId("dictionary-batch-preview");
    expect(preview).toHaveTextContent(
      "Preview: 3 valid unique terms (1 duplicate and 1 unsupported entry removed)."
    );
    expect(preview).toHaveAttribute("data-unique-count", "3");
    expect(preview).toHaveAttribute("data-duplicate-count", "1");
    expect(preview).toHaveAttribute("data-invalid-count", "1");
  });
});
