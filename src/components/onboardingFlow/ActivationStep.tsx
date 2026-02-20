import { Textarea } from "../ui/textarea";
import { HotkeyInput } from "../ui/HotkeyInput";
import { ActivationModeSelector } from "../ui/ActivationModeSelector";

export function OnboardingActivationStep({
  hotkey,
  onHotkeyChange,
  isHotkeyRegistering,
  validateHotkey,
  activationMode,
  setActivationMode,
  isUsingGnomeHotkeys,
  readableHotkey,
}: {
  hotkey: string;
  onHotkeyChange: (hotkey: string) => Promise<void>;
  isHotkeyRegistering: boolean;
  validateHotkey: (hotkey: string) => string | null | undefined;
  activationMode: "tap" | "push";
  setActivationMode: (mode: "tap" | "push") => void;
  isUsingGnomeHotkeys: boolean;
  readableHotkey: string;
}) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-0.5">
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Activation Setup</h2>
        <p className="text-xs text-muted-foreground">Configure how you trigger dictation</p>
      </div>

      {/* Unified control surface */}
      <div className="rounded-lg border border-border-subtle bg-surface-1 overflow-hidden">
        {/* Hotkey section */}
        <div className="p-4 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Hotkey
            </span>
          </div>
          <HotkeyInput
            value={hotkey}
            onChange={(newHotkey) => void onHotkeyChange(newHotkey)}
            disabled={isHotkeyRegistering}
            variant="hero"
            validate={validateHotkey}
          />
        </div>

        {/* Mode section - inline with hotkey */}
        {!isUsingGnomeHotkeys && (
          <div className="p-4 flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Mode
              </span>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                {activationMode === "tap" ? "Press to start/stop" : "Hold while speaking"}
              </p>
            </div>
            <ActivationModeSelector
              value={activationMode}
              onChange={setActivationMode}
              variant="compact"
            />
          </div>
        )}
      </div>

      {/* Test area - minimal chrome */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Test
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {activationMode === "tap" || isUsingGnomeHotkeys
              ? `${readableHotkey} to start/stop`
              : `Hold ${readableHotkey}`}
          </span>
        </div>
        <Textarea
          rows={2}
          placeholder="Click here and use your hotkey to dictate..."
          className="text-sm resize-none"
        />
      </div>
    </div>
  );
}

