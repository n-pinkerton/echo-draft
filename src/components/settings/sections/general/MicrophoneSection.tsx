import MicrophoneSettings from "../../../ui/MicrophoneSettings";
import { useSettings } from "../../../../hooks/useSettings";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function MicrophoneSection() {
  const {
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
  } = useSettings();

  return (
    <div>
      <SectionHeader title="Microphone" description="Select which input device to use for dictation" />
      <SettingsPanel>
        <SettingsPanelRow>
          <MicrophoneSettings
            preferBuiltInMic={preferBuiltInMic}
            selectedMicDeviceId={selectedMicDeviceId}
            onPreferBuiltInChange={setPreferBuiltInMic}
            onDeviceSelect={setSelectedMicDeviceId}
          />
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

