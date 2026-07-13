import {
  Clipboard,
  Keyboard,
  Settings2,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { getReasoningModelLabel } from "../../models/ModelRegistry";
import { formatHotkeyLabel } from "../../utils/hotkeys";
import { Button } from "../ui/button";
import QuickMicrophoneSelect from "./QuickMicrophoneSelect";

type CleanupSummary = {
  status?: string;
  fallbackReason?: string | null;
} | null;

type Props = {
  insertHotkey: string;
  clipboardHotkey: string;
  activationMode: "tap" | "push";
  cleanupEnabled: boolean;
  cleanupModel: string;
  cleanupManagedByCloud: boolean;
  latestCleanup: CleanupSummary;
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  onPreferBuiltInChange: (value: boolean) => void;
  onDeviceSelect: (deviceId: string) => void;
  onOpenHotkeySettings: () => void;
  onOpenMicrophoneSettings: () => void;
  onOpenCleanupSettings: () => void;
};

const Shortcut = ({
  icon: Icon,
  hotkey,
  label,
}: {
  icon: LucideIcon;
  hotkey: string;
  label: string;
}) => (
  <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2.5 py-2">
    <Icon size={14} className="shrink-0 text-primary" aria-hidden="true" />
    <kbd className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-sm">
      {formatHotkeyLabel(hotkey)}
    </kbd>
    <span className="min-w-0 text-[11px] leading-tight text-muted-foreground">{label}</span>
  </div>
);

export default function DictationQuickStart(props: Props) {
  const {
    insertHotkey,
    clipboardHotkey,
    activationMode,
    cleanupEnabled,
    cleanupModel,
    cleanupManagedByCloud,
    latestCleanup,
    preferBuiltInMic,
    selectedMicDeviceId,
    onPreferBuiltInChange,
    onDeviceSelect,
    onOpenHotkeySettings,
    onOpenMicrophoneSettings,
    onOpenCleanupSettings,
  } = props;
  const cleanupFallback = cleanupEnabled && latestCleanup?.status === "fallback";
  const cleanupNeedsSetup = cleanupEnabled && !cleanupManagedByCloud && !cleanupModel;
  const cleanupWarning = cleanupFallback || cleanupNeedsSetup;
  const cleanupFallbackLabel =
    latestCleanup?.fallbackReason === "fidelity_rejected"
      ? "Last cleanup changed too much · original kept"
      : latestCleanup?.fallbackReason === "not_configured"
        ? "Last cleanup needed setup · original kept"
        : "Last cleanup was unavailable · original kept";
  const cleanupStatusLabel = cleanupFallback
    ? cleanupFallbackLabel
    : cleanupNeedsSetup
      ? "Cleanup needs a model"
      : cleanupEnabled
        ? cleanupManagedByCloud
          ? "Cleanup on · EchoDraft cloud"
          : `Cleanup on · ${getReasoningModelLabel(cleanupModel)}`
        : "Cleanup off";
  const activationHint =
    activationMode === "push"
      ? "Hold a shortcut while speaking"
      : "Press once to start, again to stop";

  return (
    <section
      aria-label="Dictation shortcuts and cleanup status"
      className="mb-3 rounded-lg border border-border bg-card/60 px-3 py-2.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Keyboard size={14} className="shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-[12px] font-semibold text-foreground">Dictation shortcuts</p>
            <p className="text-[10px] text-muted-foreground">{activationHint}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
          onClick={onOpenHotkeySettings}
        >
          <Settings2 size={12} className="mr-1" aria-hidden="true" />
          Shortcuts
        </Button>
      </div>

      <div className="mt-2">
        <QuickMicrophoneSelect
          preferBuiltInMic={preferBuiltInMic}
          selectedMicDeviceId={selectedMicDeviceId}
          onPreferBuiltInChange={onPreferBuiltInChange}
          onDeviceSelect={onDeviceSelect}
          onOpenMicrophoneSettings={onOpenMicrophoneSettings}
        />
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(240px,0.9fr)]">
        <Shortcut icon={Keyboard} hotkey={insertHotkey} label="Insert in active app" />
        <Shortcut icon={Clipboard} hotkey={clipboardHotkey} label="Copy to clipboard" />
        <button
          type="button"
          onClick={onOpenCleanupSettings}
          aria-label={`Configure AI cleanup. ${cleanupStatusLabel}`}
          className={`flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2.5 py-2 text-left text-[11px] ${
            cleanupWarning ? "text-warning-text" : "text-muted-foreground"
          } md:col-span-2 hover:bg-muted/60 hover:text-foreground xl:col-span-1`}
        >
          {cleanupWarning ? (
            <TriangleAlert size={13} className="shrink-0" aria-hidden="true" />
          ) : (
            <Sparkles size={13} className="shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 leading-tight" aria-live="polite">
            {cleanupStatusLabel}
          </span>
        </button>
      </div>
    </section>
  );
}
