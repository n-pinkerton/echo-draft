import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useGuestTranscriptionPickerProps } from "./useGuestTranscriptionPickerProps";

function TestComponent({
  params,
  onReady,
}: {
  params: any;
  onReady: (value: any) => void;
}) {
  const props = useGuestTranscriptionPickerProps(params);
  useEffect(() => {
    onReady(props);
  }, [onReady, props]);
  return null;
}

describe("useGuestTranscriptionPickerProps", () => {
  it("maps selection callbacks to updateTranscriptionSettings", async () => {
    const updateTranscriptionSettings = vi.fn();
    const setOpenaiApiKey = vi.fn();
    const setGroqApiKey = vi.fn();
    const setMistralApiKey = vi.fn();
    const setCustomTranscriptionApiKey = vi.fn();

    let captured: any = null;

    render(
      <TestComponent
        onReady={(value) => {
          captured = value;
        }}
        params={{
          useLocalWhisper: false,
          whisperModel: "base",
          parakeetModel: "",
          localTranscriptionProvider: "whisper",
          cloudTranscriptionProvider: "openai",
          cloudTranscriptionModel: "gpt-4o-mini-transcribe",
          cloudTranscriptionBaseUrl: "https://api.openai.com/v1",
          openaiApiKey: "sk-openai",
          setOpenaiApiKey,
          groqApiKey: "",
          setGroqApiKey,
          mistralApiKey: "",
          setMistralApiKey,
          customTranscriptionApiKey: "",
          setCustomTranscriptionApiKey,
          updateTranscriptionSettings,
        }}
      />
    );

    expect(captured.selectedCloudProvider).toBe("openai");
    captured.onCloudProviderSelect("groq");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ cloudTranscriptionProvider: "groq" });

    captured.onCloudModelSelect("gpt-4o-transcribe");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ cloudTranscriptionModel: "gpt-4o-transcribe" });

    captured.onModeChange(true);
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ useLocalWhisper: true });

    captured.onLocalProviderSelect("nvidia");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ localTranscriptionProvider: "nvidia" });

    captured.onLocalModelSelect("parakeet-small");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ whisperModel: "parakeet-small" });

    captured.setCloudTranscriptionBaseUrl("http://localhost");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ cloudTranscriptionBaseUrl: "http://localhost" });

    expect(captured.setOpenaiApiKey).toBe(setOpenaiApiKey);
    expect(captured.setGroqApiKey).toBe(setGroqApiKey);
    expect(captured.setMistralApiKey).toBe(setMistralApiKey);
    expect(captured.setCustomTranscriptionApiKey).toBe(setCustomTranscriptionApiKey);
  });

  it("selects parakeet model when NVIDIA provider is active", () => {
    const updateTranscriptionSettings = vi.fn();
    let captured: any = null;

    render(
      <TestComponent
        onReady={(value) => {
          captured = value;
        }}
        params={{
          useLocalWhisper: true,
          whisperModel: "base",
          parakeetModel: "parakeet-small",
          localTranscriptionProvider: "nvidia",
          cloudTranscriptionProvider: "openai",
          cloudTranscriptionModel: "gpt-4o-mini-transcribe",
          cloudTranscriptionBaseUrl: "https://api.openai.com/v1",
          openaiApiKey: "",
          setOpenaiApiKey: vi.fn(),
          groqApiKey: "",
          setGroqApiKey: vi.fn(),
          mistralApiKey: "",
          setMistralApiKey: vi.fn(),
          customTranscriptionApiKey: "",
          setCustomTranscriptionApiKey: vi.fn(),
          updateTranscriptionSettings,
        }}
      />
    );

    expect(captured.selectedLocalModel).toBe("parakeet-small");
    captured.onLocalModelSelect("parakeet-medium");
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ parakeetModel: "parakeet-medium" });
  });
});

