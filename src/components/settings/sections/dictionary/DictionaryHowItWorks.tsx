import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function DictionaryHowItWorks() {
  return (
    <div>
      <SectionHeader title="How it works" />
      <SettingsPanel>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            EchoDraft can use up to 100 saved words to help spell uncommon names, technical terms,
            and brands. Supported transcription engines receive only those words in their dedicated
            spelling-hint field. When you use your own API key for text cleanup, the cleanup model
            can receive the same words as preferred spellings - for example, to correct a
            final-vowel recognition error such as “Rilji” to your saved name “Rilje.”
          </p>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Tip</span> — Add one term per entry, such
            as "Synty" and "SyntyStudios". Dictionary entries are never sent as instructions.
            Providers without a spelling field simply transcribe without these hints, and managed
            EchoDraft Cloud does not receive your private dictionary.
          </p>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
