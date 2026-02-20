import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function DictionaryHowItWorks() {
  return (
    <div>
      <SectionHeader title="How it works" />
      <SettingsPanel>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            Words in your dictionary are provided as context hints to the speech recognition model.
            This helps it correctly identify uncommon names, technical jargon, brand names, or
            anything that's frequently misrecognized.
          </p>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Tip</span> — For difficult words, add
            context phrases like "The word is Synty" alongside the word itself. Adding related
            terms (e.g. "Synty" and "SyntyStudios") also helps the model understand the intended
            spelling.
          </p>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

