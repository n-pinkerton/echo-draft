import { EventEmitter } from "node:events";

import { CancelableRequestRegistry } from "../../src/helpers/ipc/cancelableRequestRegistry.js";
import { registerProviderRequestHandlers } from "../../src/helpers/ipc/handlers/providerRequestHandlers.js";

export const createSecureProviderTestBridge = (openAiApiKey: string) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
  };
  const frame = { url: "file:///private-eval/index.html?view=dictation" };
  const sender = new EventEmitter() as EventEmitter & {
    id: number;
    mainFrame: typeof frame;
    getURL: () => string;
  };
  sender.id = 19;
  sender.mainFrame = frame;
  sender.getURL = () => frame.url;
  const event = { sender, senderFrame: frame };
  const windowManager = {
    mainWindow: {
      __echoDraftTrustedUrl: frame.url,
      webContents: sender,
      isDestroyed: () => false,
    },
    controlPanelWindow: null,
  };
  const cancelableRequests = new CancelableRequestRegistry();
  const environmentManager = {
    getOpenAIKey: () => openAiApiKey,
    getAnthropicKey: () => "",
    getGeminiKey: () => "",
    getGroqKey: () => "",
    getMistralKey: () => "",
    getCustomTranscriptionKey: () => "",
    getCustomReasoningKey: () => "",
    getCustomTranscriptionBaseUrl: () => "",
    getCustomReasoningBaseUrl: () => "",
  };

  registerProviderRequestHandlers(
    { ipcMain } as any,
    {
      environmentManager,
      cancelableRequests,
      windowManager,
      fetchImpl: globalThis.fetch.bind(globalThis),
    } as any
  );

  const invoke = (channel: string, ...args: any[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Secure provider test handler is unavailable: ${channel}`);
    return handler(event, ...args);
  };

  return {
    getApiKeyStatus: () => invoke("get-api-key-status"),
    providerCleanupRequest: (payload: unknown, requestId: string) =>
      invoke("provider-cleanup-request", payload, requestId),
    providerTranscriptionRequest: (payload: unknown, requestId: string) =>
      invoke("provider-transcription-request", payload, requestId),
    cancelIpcRequest: async (requestId: string) => {
      try {
        return { success: cancelableRequests.cancel(event, requestId) };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          code: (error as Error & { code?: string }).code,
        };
      }
    },
  };
};
