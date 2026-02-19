import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import HistoryPanel from "./HistoryPanel";
import type { TranscriptionItem as TranscriptionItemType } from "../../types/electron";

const makeItem = (id: number, text: string): TranscriptionItemType => ({
  id,
  text,
  raw_text: text,
  timestamp: "2026-02-19 00:00:00",
  created_at: "2026-02-19 00:00:00",
  meta: {
    outputMode: "clipboard",
    status: "success",
    provider: "openai",
    model: "gpt-4o-transcribe",
    timings: { recordDurationMs: 1000 },
  },
});

describe("HistoryPanel", () => {
  it("renders loading state", () => {
    render(
      <HistoryPanel
        history={[makeItem(1, "hello")]}
        filteredHistory={[makeItem(1, "hello")]}
        providerOptions={["openai"]}
        isLoading
        hotkey="F9"
        searchQuery=""
        setSearchQuery={vi.fn()}
        modeFilter="all"
        setModeFilter={vi.fn()}
        statusFilter="all"
        setStatusFilter={vi.fn()}
        providerFilter="all"
        setProviderFilter={vi.fn()}
        exportTranscriptions={vi.fn(async () => {})}
        isExporting={false}
        copyToClipboard={vi.fn(async () => {})}
        copyDiagnostics={vi.fn(async () => {})}
        deleteTranscription={vi.fn(async () => {})}
      />
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders empty history state", () => {
    render(
      <HistoryPanel
        history={[]}
        filteredHistory={[]}
        providerOptions={[]}
        isLoading={false}
        hotkey="F9"
        searchQuery=""
        setSearchQuery={vi.fn()}
        modeFilter="all"
        setModeFilter={vi.fn()}
        statusFilter="all"
        setStatusFilter={vi.fn()}
        providerFilter="all"
        setProviderFilter={vi.fn()}
        exportTranscriptions={vi.fn(async () => {})}
        isExporting={false}
        copyToClipboard={vi.fn(async () => {})}
        copyDiagnostics={vi.fn(async () => {})}
        deleteTranscription={vi.fn(async () => {})}
      />
    );

    expect(screen.getByText("No transcriptions yet")).toBeInTheDocument();
    expect(screen.getByText("F9")).toBeInTheDocument();
  });

  it("resets filters when no results match", () => {
    const setSearchQuery = vi.fn();
    const setModeFilter = vi.fn();
    const setStatusFilter = vi.fn();
    const setProviderFilter = vi.fn();

    render(
      <HistoryPanel
        history={[makeItem(1, "hello")]}
        filteredHistory={[]}
        providerOptions={["openai"]}
        isLoading={false}
        hotkey="F9"
        searchQuery="hi"
        setSearchQuery={setSearchQuery}
        modeFilter="clipboard"
        setModeFilter={setModeFilter}
        statusFilter="error"
        setStatusFilter={setStatusFilter}
        providerFilter="openai"
        setProviderFilter={setProviderFilter}
        exportTranscriptions={vi.fn(async () => {})}
        isExporting={false}
        copyToClipboard={vi.fn(async () => {})}
        copyDiagnostics={vi.fn(async () => {})}
        deleteTranscription={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(setSearchQuery).toHaveBeenCalledWith("");
    expect(setModeFilter).toHaveBeenCalledWith("all");
    expect(setStatusFilter).toHaveBeenCalledWith("all");
    expect(setProviderFilter).toHaveBeenCalledWith("all");
  });

  it("renders transcription list", () => {
    const copyToClipboard = vi.fn(async () => {});

    render(
      <HistoryPanel
        history={[makeItem(1, "hello"), makeItem(2, "world")]}
        filteredHistory={[makeItem(1, "hello"), makeItem(2, "world")]}
        providerOptions={["openai"]}
        isLoading={false}
        hotkey="F9"
        searchQuery=""
        setSearchQuery={vi.fn()}
        modeFilter="all"
        setModeFilter={vi.fn()}
        statusFilter="all"
        setStatusFilter={vi.fn()}
        providerFilter="all"
        setProviderFilter={vi.fn()}
        exportTranscriptions={vi.fn(async () => {})}
        isExporting={false}
        copyToClipboard={copyToClipboard}
        copyDiagnostics={vi.fn(async () => {})}
        deleteTranscription={vi.fn(async () => {})}
      />
    );

    expect(screen.getAllByTestId("transcription-item")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    expect(copyToClipboard).toHaveBeenCalledWith("hello");
  });
});
