import { describe, expect, it } from "vitest";
import { canProceed } from "./canProceed";

const makePermissions = (partial: any = {}) => ({
  micPermissionGranted: false,
  accessibilityPermissionGranted: false,
  pasteToolsInfo: { platform: "win32" },
  ...partial,
});

describe("canProceed", () => {
  it("allows step 0 when signed in or skipAuth", () => {
    expect(
      canProceed({
        currentStep: 0,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);

    expect(
      canProceed({
        currentStep: 0,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);
  });

  it("blocks step 0 when not signed in and not skipping auth", () => {
    expect(
      canProceed({
        currentStep: 0,
        isSignedIn: false,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);
  });

  it("requires permissions for signed-in setup", () => {
    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions({ micPermissionGranted: false }),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions({
          micPermissionGranted: true,
          pasteToolsInfo: { platform: "darwin" },
          accessibilityPermissionGranted: false,
        }),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions({
          micPermissionGranted: true,
          pasteToolsInfo: { platform: "win32" },
        }),
      })
    ).toBe(true);
  });

  it("requires local model selection + download for guest local mode", () => {
    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: true,
        localTranscriptionProvider: "whisper",
        whisperModel: "",
        parakeetModel: "",
        isModelDownloaded: true,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: true,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: true,
        localTranscriptionProvider: "nvidia",
        whisperModel: "base",
        parakeetModel: "parakeet-small",
        isModelDownloaded: true,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);
  });

  it("requires the correct API key for guest cloud mode", () => {
    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "  ",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "groq",
        openaiApiKey: "sk-openai",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "groq",
        openaiApiKey: "sk-openai",
        groqApiKey: "gsk-groq",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "mistral",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "mistral-key",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);

    expect(
      canProceed({
        currentStep: 1,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "custom",
        openaiApiKey: "",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(true);
  });

  it("requires hotkey on activation steps", () => {
    expect(
      canProceed({
        currentStep: 2,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "sk",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "",
        permissions: makePermissions(),
      })
    ).toBe(false);

    expect(
      canProceed({
        currentStep: 2,
        isSignedIn: true,
        skipAuth: false,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "sk",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: "CTRL+K",
        permissions: makePermissions(),
      })
    ).toBe(true);

    expect(
      canProceed({
        currentStep: 3,
        isSignedIn: false,
        skipAuth: true,
        useLocalWhisper: false,
        localTranscriptionProvider: "whisper",
        whisperModel: "base",
        parakeetModel: "",
        isModelDownloaded: false,
        cloudTranscriptionProvider: "openai",
        openaiApiKey: "sk",
        groqApiKey: "",
        mistralApiKey: "",
        hotkey: " ",
        permissions: makePermissions(),
      })
    ).toBe(false);
  });
});

