import { Play, Volume2 } from "lucide-react";

import { useLocalStorage } from "../../../../hooks/useLocalStorage";
import {
  DEFAULT_DICTATION_SOUND_VOLUME,
  DICTATION_FEEDBACK_STORAGE_KEYS,
  playCancelCue,
  playCompletionCue,
  playErrorCue,
  playStartCue,
  playStopCue,
  playWarningCue,
} from "../../../../utils/dictationCues";
import { SettingsRow } from "../../../ui/SettingsSection";
import { Toggle } from "../../../ui/toggle";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

const serializeBoolean = (value: boolean) => String(value);
const deserializeBoolean = (value: string) => value !== "false";
const serializeNumber = (value: number) => String(value);
const deserializeVolume = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(0, parsed))
    : DEFAULT_DICTATION_SOUND_VOLUME;
};

const CUE_PREVIEWS = [
  { label: "Start", description: "Recording started", play: playStartCue },
  { label: "Stop", description: "Recording stopped; queued or processing", play: playStopCue },
  { label: "Ready", description: "Text delivered", play: playCompletionCue },
  { label: "Warning", description: "Text delivered with a warning", play: playWarningCue },
  { label: "Error", description: "Action failed", play: playErrorCue },
  { label: "Cancel", description: "Action cancelled", play: playCancelCue },
] as const;

export default function SoundFeedbackSection() {
  const [soundsEnabled, setSoundsEnabled] = useLocalStorage<boolean>(
    DICTATION_FEEDBACK_STORAGE_KEYS.soundsEnabled,
    true,
    { serialize: serializeBoolean, deserialize: deserializeBoolean }
  );
  const [soundVolume, setSoundVolume] = useLocalStorage<number>(
    DICTATION_FEEDBACK_STORAGE_KEYS.soundVolume,
    DEFAULT_DICTATION_SOUND_VOLUME,
    { serialize: serializeNumber, deserialize: deserializeVolume }
  );
  const [recordingIndicatorEnabled, setRecordingIndicatorEnabled] = useLocalStorage<boolean>(
    DICTATION_FEEDBACK_STORAGE_KEYS.recordingIndicatorEnabled,
    true,
    { serialize: serializeBoolean, deserialize: deserializeBoolean }
  );
  const [longRecordingReminderEnabled, setLongRecordingReminderEnabled] = useLocalStorage<boolean>(
    DICTATION_FEEDBACK_STORAGE_KEYS.longRecordingReminderEnabled,
    true,
    { serialize: serializeBoolean, deserialize: deserializeBoolean }
  );

  return (
    <div>
      <SectionHeader
        title="Sound & feedback"
        description="Make each dictation state easy to identify without looking away"
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label="Dictation sounds"
            description="Hear distinct cues for recording, stopping or queueing, completion, warnings, cancellation, and errors"
          >
            <Toggle
              checked={soundsEnabled}
              onChange={setSoundsEnabled}
              ariaLabel="Enable dictation sounds"
            />
          </SettingsRow>
        </SettingsPanelRow>

        <SettingsPanelRow>
          <SettingsRow
            label="Sound volume"
            description="Preview volume is available even when dictation sounds are disabled"
          >
            <div className="flex w-48 items-center gap-2">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={soundVolume}
                onChange={(event) => setSoundVolume(Number(event.target.value))}
                aria-label="Dictation sound volume"
                className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
              />
              <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                {soundVolume}%
              </span>
            </div>
          </SettingsRow>
        </SettingsPanelRow>

        <SettingsPanelRow>
          <SettingsRow
            label="Recording timer"
            description="Show a click-through REC timer while the microphone is live"
          >
            <Toggle
              checked={recordingIndicatorEnabled}
              onChange={setRecordingIndicatorEnabled}
              ariaLabel="Show recording timer"
            />
          </SettingsRow>
        </SettingsPanelRow>

        <SettingsPanelRow>
          <SettingsRow
            label="Long recording reminder"
            description='After one minute, the recording timer highlights "Still recording" without playing a sound'
          >
            <Toggle
              checked={longRecordingReminderEnabled}
              onChange={setLongRecordingReminderEnabled}
              ariaLabel="Show long recording reminder"
              disabled={!recordingIndicatorEnabled}
            />
          </SettingsRow>
        </SettingsPanelRow>

        <SettingsPanelRow>
          <div>
            <p className="text-[12px] font-medium text-foreground">Preview sounds</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
              Start rises, Stop falls, Ready chimes, and Warning uses a paired descending tone.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {CUE_PREVIEWS.map((cue) => (
                <button
                  key={cue.label}
                  type="button"
                  onClick={() => void cue.play({ force: true, volume: soundVolume })}
                  aria-label={`Preview ${cue.description.toLowerCase()} sound`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                  {cue.label}
                </button>
              ))}
            </div>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
