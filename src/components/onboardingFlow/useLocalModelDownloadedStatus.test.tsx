import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLocalModelDownloadedStatus } from "./useLocalModelDownloadedStatus";

function TestComponent(props: any) {
  const isModelDownloaded = useLocalModelDownloadedStatus(props);
  return <div>{String(isModelDownloaded)}</div>;
}

describe("useLocalModelDownloadedStatus", () => {
  it("checks whisper model status when local whisper is enabled", async () => {
    const checkModelStatus = vi.fn(async () => ({ downloaded: true }));
    (window as any).electronAPI = { checkModelStatus };

    render(
      <TestComponent
        useLocalWhisper={true}
        localTranscriptionProvider="whisper"
        whisperModel="base"
        parakeetModel=""
      />
    );

    await waitFor(() => expect(checkModelStatus).toHaveBeenCalledWith("base"));
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("checks parakeet model status when NVIDIA provider is selected", async () => {
    const checkParakeetModelStatus = vi.fn(async () => ({ downloaded: true }));
    (window as any).electronAPI = { checkParakeetModelStatus };

    render(
      <TestComponent
        useLocalWhisper={true}
        localTranscriptionProvider="nvidia"
        whisperModel="base"
        parakeetModel="parakeet-small"
      />
    );

    await waitFor(() => expect(checkParakeetModelStatus).toHaveBeenCalledWith("parakeet-small"));
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("returns false when local whisper is disabled", async () => {
    const checkModelStatus = vi.fn(async () => ({ downloaded: true }));
    (window as any).electronAPI = { checkModelStatus };

    render(
      <TestComponent
        useLocalWhisper={false}
        localTranscriptionProvider="whisper"
        whisperModel="base"
        parakeetModel=""
      />
    );

    await waitFor(() => expect(screen.getByText("false")).toBeInTheDocument());
    expect(checkModelStatus).not.toHaveBeenCalled();
  });
});

