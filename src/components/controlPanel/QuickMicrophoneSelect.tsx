import { useMemo } from "react";
import { Mic, RefreshCw, TriangleAlert } from "lucide-react";

import { useAudioInputDevices } from "../../hooks/useAudioInputDevices";
import { Button } from "../ui/button";

const AUTOMATIC_MIC = "__automatic_builtin__";
const SYSTEM_DEFAULT_MIC = "__system_default__";

type Props = {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  onPreferBuiltInChange: (value: boolean) => void;
  onDeviceSelect: (deviceId: string) => void;
  onOpenMicrophoneSettings?: () => void;
};

export default function QuickMicrophoneSelect({
  preferBuiltInMic,
  selectedMicDeviceId,
  onPreferBuiltInChange,
  onDeviceSelect,
  onOpenMicrophoneSettings,
}: Props) {
  const {
    devices,
    isLoading,
    error,
    hasLoaded,
    hasHiddenLabels,
    systemDefaultLabel,
    refreshDevices,
    requestDeviceLabels,
  } = useAudioInputDevices();

  const value = preferBuiltInMic ? AUTOMATIC_MIC : selectedMicDeviceId || SYSTEM_DEFAULT_MIC;
  const selectedDeviceAvailable = useMemo(
    () => devices.some((device) => device.deviceId === selectedMicDeviceId),
    [devices, selectedMicDeviceId]
  );
  const selectedDeviceUnavailable =
    !preferBuiltInMic && Boolean(selectedMicDeviceId) && hasLoaded && !selectedDeviceAvailable;

  const handleChange = (nextValue: string) => {
    if (nextValue === AUTOMATIC_MIC) {
      onPreferBuiltInChange(true);
      return;
    }

    onPreferBuiltInChange(false);
    onDeviceSelect(nextValue === SYSTEM_DEFAULT_MIC ? "" : nextValue);
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-3 md:flex-row md:flex-wrap md:items-center"
      data-testid="quick-microphone-select"
    >
      <div className="flex min-w-[165px] items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Mic size={16} aria-hidden="true" />
        </span>
        <div>
          <label htmlFor="quick-microphone" className="block text-sm font-semibold text-foreground">
            Microphone
          </label>
          <p className="text-xs leading-tight text-muted-foreground">
            Used for your next dictation
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <select
          id="quick-microphone"
          aria-label="Microphone used for dictation"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground outline-none transition-colors focus:border-primary focus:ring-[3px] focus:ring-primary/15"
        >
          <option value={AUTOMATIC_MIC}>Automatic (prefer built-in)</option>
          <option value={SYSTEM_DEFAULT_MIC}>Windows default microphone</option>
          {!preferBuiltInMic && selectedMicDeviceId && !selectedDeviceAvailable && (
            <option value={selectedMicDeviceId}>
              {hasLoaded
                ? "Previously selected microphone (unavailable)"
                : error
                  ? "Could not verify selected microphone"
                  : "Checking selected microphone…"}
            </option>
          )}
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground"
          onClick={() => void refreshDevices()}
          disabled={isLoading}
          aria-label="Refresh microphones"
          title="Refresh microphones"
        >
          <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
        </Button>
      </div>

      {(hasHiddenLabels || error) && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground md:basis-full">
          <span role="status">
            {error || "Windows is hiding microphone names until access is granted."}
          </span>
          {hasHiddenLabels && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              onClick={() => void requestDeviceLabels()}
              disabled={isLoading}
            >
              Show device names
            </Button>
          )}
        </div>
      )}

      {selectedDeviceUnavailable && (
        <div
          className="flex min-w-0 flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs md:basis-full md:flex-row md:items-center md:justify-between"
          role="status"
        >
          <div className="flex min-w-0 items-start gap-2">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="font-semibold text-warning-text">Selected microphone disconnected</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                EchoDraft is temporarily using{" "}
                {systemDefaultLabel || "the Windows default microphone"}. Your saved microphone will
                be tried again when it reconnects.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 pl-5 md:pl-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => onDeviceSelect("")}
            >
              Switch to Windows default
            </Button>
            {onOpenMicrophoneSettings && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={onOpenMicrophoneSettings}
              >
                Mic settings
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
