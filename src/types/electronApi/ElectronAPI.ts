import type { ElectronAPIAssemblyAiStreaming } from "./assemblyAiStreaming";
import type { ElectronAPIClipboard } from "./clipboard";
import type { ElectronAPICloud } from "./cloud";
import type { ElectronAPIDatabase } from "./database";
import type { ElectronAPIDebugLogging } from "./debug";
import type { ElectronAPIDictionary } from "./dictionary";
import type { ElectronAPIHotkeys } from "./hotkeys";
import type { ElectronAPIKeys } from "./keys";
import type { ElectronAPIModels } from "./models";
import type { ElectronAPISystem } from "./system";
import type { ElectronAPIUpdates } from "./updates";
import type { ElectronAPIWindow } from "./window";

export interface ElectronAPI
  extends ElectronAPIWindow,
    ElectronAPIDatabase,
    ElectronAPIDictionary,
    ElectronAPIKeys,
    ElectronAPIClipboard,
    ElectronAPIModels,
    ElectronAPIUpdates,
    ElectronAPIHotkeys,
    ElectronAPIDebugLogging,
    ElectronAPISystem,
    ElectronAPICloud,
    ElectronAPIAssemblyAiStreaming {}

