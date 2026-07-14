import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TranscriptionItem from "./TranscriptionItem";

const makeItem = (rawText: string | null | undefined, meta: Record<string, unknown> = {}) => ({
  id: 1,
  text: "Finished text",
  raw_text: rawText,
  timestamp: "2026-07-12T00:00:00",
  created_at: "2026-07-12T00:00:00",
  meta,
});

describe("TranscriptionItem", () => {
  it.each([null, undefined, "   "])(
    "never substitutes finished text for an unavailable raw transcript (%s)",
    (rawText) => {
      const onCopyClean = vi.fn();
      const onCopyRaw = vi.fn();
      render(
        <TranscriptionItem
          item={makeItem(rawText) as any}
          index={0}
          total={1}
          onCopyClean={onCopyClean}
          onCopyRaw={onCopyRaw}
          onCopyDiagnostics={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      const rawButton = screen.getByRole("button", {
        name: "Raw transcript unavailable for this item",
      });
      expect(rawButton).toBeDisabled();
      fireEvent.click(rawButton);
      expect(onCopyRaw).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(onCopyClean).toHaveBeenCalledWith("Finished text");
    }
  );

  it("copies stored raw text and explains a clipboard delivery fallback", () => {
    const onCopyRaw = vi.fn();
    render(
      <TranscriptionItem
        item={
          makeItem("Original raw text", {
            status: "delivery_issue",
            delivery: { status: "clipboard_fallback", succeeded: false },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={onCopyRaw}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("Delivery issue")).toBeInTheDocument();
    expect(screen.getByText("Kept in clipboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy raw transcript" }));
    expect(onCopyRaw).toHaveBeenCalledWith("Original raw text");
  });

  it("shows provider phase timings, retry count, and request ID in diagnostics", () => {
    render(
      <TranscriptionItem
        item={
          makeItem("Original raw text", {
            timings: {
              transcriptionProcessingDurationMs: 12_500,
              transcriptionTimeToHeadersMs: 10_200,
              transcriptionBodyReadDurationMs: 650,
              transcriptionTransportAttemptCount: 2,
              transcriptionRequestId: "request-123",
            },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText("Headers")).toBeInTheDocument();
    expect(screen.getByText("10s")).toBeInTheDocument();
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText("0.7s")).toBeInTheDocument();
    expect(screen.getByText("API attempts")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Request ID")).toBeInTheDocument();
    expect(screen.getByText(/^req-[a-f0-9]{8}$/)).toBeInTheDocument();
  });

  it("does not render an untrusted provider request ID", () => {
    render(
      <TranscriptionItem
        item={
          makeItem("Original raw text", {
            timings: {
              transcriptionRequestId: "PRIVATE_TRANSCRIPT_SENTINEL\r\nInjected: yes",
            },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.queryByText("Request ID")).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_TRANSCRIPT_SENTINEL/)).not.toBeInTheDocument();
  });

  it("distinguishes the selected cleanup model from a successful Sol safety retry", () => {
    render(
      <TranscriptionItem
        item={
          makeItem("Original raw text", {
            cleanup: {
              requested: true,
              attempted: true,
              applied: true,
              status: "applied",
              model: "gpt-5.6-luna",
              appliedModel: "gpt-5.6-sol",
              retryCount: 1,
            },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const detailsButton = screen.getByRole("button", { name: "Details" });
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsButton);
    expect(detailsButton).toHaveAttribute("aria-expanded", "true");
    expect(
      document.getElementById(detailsButton.getAttribute("aria-controls") || "")
    ).toBeVisible();
    const cleanupStatus = screen.getByText(/Cleanup: applied/);
    expect(cleanupStatus).toHaveTextContent("Selected: OpenAI GPT-5.6 Luna");
    expect(cleanupStatus).toHaveTextContent("Safety retry: accepted");
    expect(cleanupStatus).toHaveTextContent("Retry model: OpenAI GPT-5.6 Sol");
  });

  it("labels a service-chosen cleanup model as managed rather than selected", () => {
    render(
      <TranscriptionItem
        item={
          makeItem("Managed cleanup text", {
            cleanup: {
              requested: true,
              attempted: true,
              applied: true,
              status: "applied",
              model: "gpt-5.6-luna",
              appliedModel: "gpt-5.6-luna",
              modelSource: "managed",
              provider: "echodraft-cloud",
              retryCount: 0,
            },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const cleanupStatus = screen.getByText(/Cleanup: applied/);
    expect(cleanupStatus).toHaveTextContent("Managed model: OpenAI GPT-5.6 Luna");
    expect(cleanupStatus).not.toHaveTextContent("Selected:");
  });

  it("describes an unchanged accepted retry without implying that wording was applied", () => {
    render(
      <TranscriptionItem
        item={
          {
            id: 14,
            text: "Keep every original word.",
            raw_text: "Keep every original word.",
            timestamp: "2026-07-14T00:00:00",
            meta: {
              cleanup: {
                requested: true,
                status: "unchanged",
                retryCount: 1,
                model: "gpt-5.6-luna",
                appliedModel: "gpt-5.6-sol",
              },
            },
          } as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const cleanupStatus = screen.getByText(/Cleanup: unchanged/);
    expect(cleanupStatus).toHaveTextContent("Safety retry: accepted");
    expect(cleanupStatus).toHaveTextContent("Retry model: OpenAI GPT-5.6 Sol");
    expect(cleanupStatus).not.toHaveTextContent("applied");
  });

  it("labels a rejected safety retry without implying cleanup was applied", () => {
    render(
      <TranscriptionItem
        item={
          makeItem("Original raw text", {
            cleanup: {
              requested: true,
              attempted: true,
              applied: false,
              status: "fallback",
              fallbackReason: "fidelity_rejected",
              model: "gpt-5.6-luna",
              appliedModel: null,
              retryCount: 1,
            },
          }) as any
        }
        index={0}
        total={1}
        onCopyClean={vi.fn()}
        onCopyRaw={vi.fn()}
        onCopyDiagnostics={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const cleanupStatus = screen.getByText(/Cleanup: original transcript preserved/);
    expect(cleanupStatus).toHaveTextContent("Safety retry: not applied");
    expect(cleanupStatus).not.toHaveTextContent("Retry model: OpenAI GPT-5.6 Sol");
  });
});
