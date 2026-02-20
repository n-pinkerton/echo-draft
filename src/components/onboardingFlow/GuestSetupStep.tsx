import type { ComponentProps } from "react";
import LanguageSelector from "../ui/LanguageSelector";
import TranscriptionModelPicker from "../TranscriptionModelPicker";

type TranscriptionPickerProps = Omit<ComponentProps<typeof TranscriptionModelPicker>, "variant">;

export function GuestSetupStep({
  transcriptionPickerProps,
  preferredLanguage,
  onPreferredLanguageChange,
}: {
  transcriptionPickerProps: TranscriptionPickerProps;
  preferredLanguage: string;
  onPreferredLanguageChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center space-y-0.5">
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Transcription Setup</h2>
        <p className="text-xs text-muted-foreground">Choose your mode and provider</p>
      </div>

      {/* Unified configuration with integrated mode toggle */}
      <TranscriptionModelPicker {...transcriptionPickerProps} variant="onboarding" />

      {/* Language Selection - shown for both modes */}
      <div className="space-y-2 p-3 bg-muted/50 border border-border/60 rounded">
        <label className="block text-xs font-medium text-muted-foreground">Preferred Language</label>
        <LanguageSelector
          value={preferredLanguage}
          onChange={onPreferredLanguageChange}
          className="w-full"
        />
      </div>
    </div>
  );
}

