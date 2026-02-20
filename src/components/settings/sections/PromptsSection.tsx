import PromptStudio from "../../ui/PromptStudio";
import { SectionHeader } from "../SettingsPanels";

export default function PromptsSection() {
  return (
    <div className="space-y-5">
      <SectionHeader
        title="Prompt Studio"
        description="View, customize, and test the unified system prompt that powers text cleanup and instruction detection"
      />

      <PromptStudio />
    </div>
  );
}

