import PromptStudio from "../../ui/PromptStudio";
import { SectionHeader } from "../SettingsPanels";

export default function PromptsSection() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Cleanup Policy"
        description="View and test EchoDraft's fixed model-specific cleanup policy and untrusted dictation wrapper"
      />

      <PromptStudio />
    </div>
  );
}
