import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function DictionaryHowItWorks() {
  return (
    <div>
      <SectionHeader title="How it works" />
      <SettingsPanel>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Single words in your dictionary can be provided as lexical hints to transcription
            engines that expose a safe structured hint field. This helps with uncommon names,
            technical terms, and brands that are frequently misrecognized.
          </p>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Tip</span> — Add one term per entry, such
            as "Synty" and "SyntyStudios". EchoDraft does not send dictionary text as a free-text
            instruction to cloud models; unsupported providers simply transcribe without a hint.
          </p>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
