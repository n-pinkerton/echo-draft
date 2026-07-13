import { Mic, RefreshCw } from "lucide-react";

import { useAudioInputDevices } from "../../hooks/useAudioInputDevices";
import { Button } from "./button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { SettingsRow } from "./SettingsSection";
import { Toggle } from "./toggle";

interface MicrophoneSettingsProps {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
  onPreferBuiltInChange: (value: boolean) => void;
  onDeviceSelect: (deviceId: string) => void;
}

export const MicrophoneSettings = ({
  preferBuiltInMic,
  selectedMicDeviceId,
  onPreferBuiltInChange,
  onDeviceSelect,
}: MicrophoneSettingsProps) => {
  const {
    devices,
    isLoading,
    error,
    hasLoaded,
    hasHiddenLabels,
    refreshDevices,
    requestDeviceLabels,
  } = useAudioInputDevices();
  const builtInDevice = devices.find((device) => device.isBuiltIn);
  const selectedDevice = devices.find((device) => device.deviceId === selectedMicDeviceId);

  return (
    <div className="space-y-4">
      <SettingsRow
        label="Prefer Built-in Microphone"
        description="External microphones may cause latency or reduced transcription quality"
      >
        <Toggle
          checked={preferBuiltInMic}
          onChange={onPreferBuiltInChange}
          ariaLabel="Prefer built-in microphone"
        />
      </SettingsRow>

      {preferBuiltInMic && builtInDevice && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 dark:bg-success/20">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-success" />
            <span className="text-sm text-success">
              Using: <span className="font-medium">{builtInDevice.label}</span>
            </span>
          </div>
        </div>
      )}

      {preferBuiltInMic &&
        hasLoaded &&
        !hasHiddenLabels &&
        !builtInDevice &&
        devices.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 dark:bg-warning/20">
            <p className="text-sm text-warning">
              No built-in microphone detected. Using system default.
            </p>
          </div>
        )}

      {!preferBuiltInMic && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Input Device</label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refreshDevices()}
              disabled={isLoading}
              className="h-7 w-7 p-0"
              aria-label="Refresh microphones"
              title="Refresh microphones"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <Select
            value={selectedMicDeviceId || "default"}
            onValueChange={(value) => onDeviceSelect(value === "default" ? "" : value)}
          >
            <SelectTrigger className="w-full" aria-label="Input device">
              <SelectValue placeholder="Select a microphone">
                {selectedMicDeviceId
                  ? selectedDevice?.label ||
                    (hasLoaded
                      ? "Previously selected microphone (unavailable)"
                      : error
                        ? "Could not verify selected microphone"
                        : "Checking…")
                  : "System Default"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System Default</SelectItem>
              {selectedMicDeviceId && !selectedDevice && hasLoaded && (
                <SelectItem value={selectedMicDeviceId} disabled>
                  Previously selected microphone (unavailable)
                </SelectItem>
              )}
              {devices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                  {device.isBuiltIn && (
                    <span className="ml-2 text-xs text-muted-foreground">(Built-in)</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-xs text-muted-foreground">
            Select a specific microphone or use the system default setting.
          </p>
        </div>
      )}

      {error && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          role="status"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void refreshDevices()}
            disabled={isLoading}
          >
            Try again
          </Button>
        </div>
      )}

      {hasHiddenLabels && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Windows is hiding microphone names until access is granted.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void requestDeviceLabels()}
            disabled={isLoading}
          >
            Show device names
          </Button>
        </div>
      )}
    </div>
  );
};

export default MicrophoneSettings;
