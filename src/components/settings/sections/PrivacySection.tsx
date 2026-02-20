import { SettingsRow } from "../../ui/SettingsSection";
import { Toggle } from "../../ui/toggle";
import { SettingsPanel, SettingsPanelRow } from "../SettingsPanels";

type Props = {
  isSignedIn: boolean;
  cloudBackupEnabled: boolean;
  setCloudBackupEnabled: (next: boolean) => void;
  telemetryEnabled: boolean;
  setTelemetryEnabled: (next: boolean) => void;
};

export default function PrivacySection(props: Props) {
  const {
    isSignedIn,
    cloudBackupEnabled,
    setCloudBackupEnabled,
    telemetryEnabled,
    setTelemetryEnabled,
  } = props;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Privacy</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Control what data leaves your device. Everything is off by default.
        </p>
      </div>

      {isSignedIn && (
        <SettingsPanel>
          <SettingsPanelRow>
            <SettingsRow
              label="Cloud backup"
              description="Save your transcriptions to the cloud so you never lose them."
            >
              <Toggle checked={cloudBackupEnabled} onChange={setCloudBackupEnabled} />
            </SettingsRow>
          </SettingsPanelRow>
        </SettingsPanel>
      )}

      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label="Usage analytics"
            description="Help us improve EchoDraft by sharing anonymous performance metrics. We never send transcription content — only timing and error data."
          >
            <Toggle checked={telemetryEnabled} onChange={setTelemetryEnabled} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

