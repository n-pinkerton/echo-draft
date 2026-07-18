import type { CleanupOutcome, TodoItem, TranscriptionTimings } from "../electron";

export interface MobileInboxStatus {
  configured: boolean;
  folderPath: string | null;
  state:
    | "not_configured"
    | "waiting"
    | "processing"
    | "retrying"
    | "folder_unavailable"
    | "item_error"
    | "stopped";
}

export interface MobileInboxProcessPayload {
  requestId: string;
  externalId: string;
  mimeType: "audio/mp4";
  createdAt: string;
  data: Uint8Array;
}

export interface MobileInboxCompletion {
  success: boolean;
  text?: string;
  rawText?: string;
  title?: string;
  source?: string;
  provider?: string;
  model?: string;
  cleanup?: CleanupOutcome;
  timings?: TranscriptionTimings;
}

export interface ElectronAPIMobileInbox {
  getMobileInboxStatus: () => Promise<MobileInboxStatus>;
  chooseMobileInboxFolder: () => Promise<{
    success: boolean;
    canceled?: boolean;
    status?: MobileInboxStatus;
  }>;
  completeMobileInboxItem: (
    requestId: string,
    result: MobileInboxCompletion
  ) => Promise<{ success: boolean; stale?: boolean }>;
  mobileInboxRendererReady: () => Promise<{ success: boolean }>;
  onMobileInboxProcess: (callback: (payload: MobileInboxProcessPayload) => void) => () => void;
  onTodoAdded: (callback: (item: TodoItem) => void) => () => void;
}
