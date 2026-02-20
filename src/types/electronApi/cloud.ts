export interface ElectronAPICloud {
  // EchoDraft Cloud API
  cloudTranscribe?: (
    audioBuffer: ArrayBuffer,
    opts: { language?: string; prompt?: string }
  ) => Promise<{
    success: boolean;
    text?: string;
    wordsUsed?: number;
    wordsRemaining?: number;
    limitReached?: boolean;
    error?: string;
    code?: string;
  }>;
  cloudReason?: (
    text: string,
    opts: { model?: string; agentName?: string; customDictionary?: string[] }
  ) => Promise<{
    success: boolean;
    text?: string;
    model?: string;
    provider?: string;
    error?: string;
    code?: string;
  }>;
  cloudUsage?: () => Promise<{
    success: boolean;
    wordsUsed?: number;
    wordsRemaining?: number;
    limit?: number;
    plan?: string;
    isSubscribed?: boolean;
    isTrial?: boolean;
    trialDaysLeft?: number | null;
    currentPeriodEnd?: string | null;
    resetAt?: string;
    error?: string;
    code?: string;
  }>;
  cloudCheckout?: () => Promise<{
    success: boolean;
    url?: string;
    error?: string;
    code?: string;
  }>;
  cloudBillingPortal?: () => Promise<{
    success: boolean;
    url?: string;
    error?: string;
    code?: string;
  }>;

  // Usage limit events
  notifyLimitReached?: (data: { wordsUsed: number; limit: number }) => void;
  onLimitReached?: (
    callback: (data: { wordsUsed: number; limit: number }) => void
  ) => () => void;
}

