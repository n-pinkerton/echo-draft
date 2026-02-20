import { useSettings } from "../../../../hooks/useSettings";
import LanguageSelector from "../../../ui/LanguageSelector";
import { SettingsRow } from "../../../ui/SettingsSection";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function LanguageSection() {
  const { preferredLanguage, updateTranscriptionSettings } = useSettings();

  return (
    <div>
      <SectionHeader title="Language" description="Set the language used for transcription" />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label="Preferred language"
            description="Choose the language you speak for more accurate transcription"
          >
            <LanguageSelector
              value={preferredLanguage}
              onChange={(value) => updateTranscriptionSettings({ preferredLanguage: value })}
            />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

