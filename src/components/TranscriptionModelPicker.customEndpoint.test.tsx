import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TranscriptionModelPicker from "./TranscriptionModelPicker";

vi.mock("../hooks/useModelDownload", () => ({
  useModelDownload: () => ({
    downloadingModel: null,
    downloadProgress: 0,
    downloadModel: vi.fn(),
    deleteModel: vi.fn(),
    isDownloadingModel: false,
    isInstalling: false,
    cancelDownload: vi.fn(),
    isCancelling: false,
  }),
}));

vi.mock("./ui/ProviderTabs", () => ({
  ProviderTabs: () => <div data-testid="provider-tabs" />,
}));

vi.mock("./ui/ModelCardList", () => ({
  default: () => <div data-testid="model-list" />,
}));

const renderPicker = (setCloudTranscriptionBaseUrl: (value: string) => any) =>
  render(
    <TranscriptionModelPicker
      selectedCloudProvider="custom"
      onCloudProviderSelect={vi.fn()}
      selectedCloudModel="whisper-1"
      onCloudModelSelect={vi.fn()}
      selectedLocalModel="base"
      onLocalModelSelect={vi.fn()}
      useLocalWhisper={false}
      onModeChange={vi.fn()}
      openaiApiKey=""
      setOpenaiApiKey={vi.fn()}
      groqApiKey=""
      setGroqApiKey={vi.fn()}
      mistralApiKey=""
      setMistralApiKey={vi.fn()}
      cloudTranscriptionBaseUrl=""
      setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
    />
  );

describe("TranscriptionModelPicker custom endpoint approval", () => {
  it("preserves first-use invalid input and shows actionable feedback", async () => {
    const approve = vi.fn(async () => ({
      status: "invalid",
      message: "Enter a valid HTTPS endpoint (HTTP is allowed only for localhost).",
    }));
    renderPicker(approve);

    const endpoint = screen.getByRole("textbox", { name: "Endpoint URL" });
    fireEvent.change(endpoint, { target: { value: "http://remote.example/v1" } });
    fireEvent.blur(endpoint);

    expect(await screen.findByRole("alert")).toHaveTextContent("valid HTTPS endpoint");
    expect(endpoint).toHaveValue("http://remote.example/v1");
  });

  it("distinguishes explicit cancellation without discarding the typed URL", async () => {
    const approve = vi.fn(async () => ({
      status: "cancelled",
      message: "Endpoint approval was cancelled. Your previous endpoint is unchanged.",
    }));
    renderPicker(approve);

    const endpoint = screen.getByRole("textbox", { name: "Endpoint URL" });
    fireEvent.change(endpoint, { target: { value: "https://cancelled.example/v1" } });
    fireEvent.blur(endpoint);

    expect(await screen.findByRole("alert")).toHaveTextContent("approval was cancelled");
    expect(endpoint).toHaveValue("https://cancelled.example/v1");
  });

  it("adopts the normalized endpoint after successful approval", async () => {
    const approve = vi.fn(async () => ({
      status: "approved",
      endpoint: "https://approved.example/v1",
    }));
    renderPicker(approve);

    const endpoint = screen.getByRole("textbox", { name: "Endpoint URL" });
    fireEvent.change(endpoint, { target: { value: "https://approved.example/v1/" } });
    fireEvent.blur(endpoint);

    await waitFor(() => expect(endpoint).toHaveValue("https://approved.example/v1"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
