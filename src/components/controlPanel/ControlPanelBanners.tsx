import { Cloud, Sparkles, X } from "lucide-react";

import { Button } from "../ui/button";

type Props = {
  showCloudMigrationBanner: boolean;
  onDismissCloudMigration: () => void;
  onViewCloudSettings: () => void;

  useReasoningModel: boolean;
  aiCTADismissed: boolean;
  onDismissAiCTA: () => void;
  onEnableAiEnhancement: () => void;
};

export default function ControlPanelBanners(props: Props) {
  const {
    showCloudMigrationBanner,
    onDismissCloudMigration,
    onViewCloudSettings,
    useReasoningModel,
    aiCTADismissed,
    onDismissAiCTA,
    onEnableAiEnhancement,
  } = props;

  return (
    <>
      {showCloudMigrationBanner && (
        <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
          <button
            onClick={onDismissCloudMigration}
            aria-label="Dismiss cloud migration banner"
            className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
              <Cloud size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground mb-0.5">
                Welcome to EchoDraft Pro
              </p>
              <p className="text-[12px] text-muted-foreground mb-2">
                Your 7-day free trial is active! We've switched your transcription to EchoDraft
                Cloud for faster, more accurate results. Your previous settings are saved — switch
                back anytime in Settings.
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onViewCloudSettings}
              >
                View Settings
              </Button>
            </div>
          </div>
        </div>
      )}

      {!useReasoningModel && !aiCTADismissed && (
        <div className="mb-3 relative rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 p-3">
          <button
            onClick={onDismissAiCTA}
            aria-label="Dismiss AI enhancement prompt"
            className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={14} />
          </button>
          <div className="flex items-start gap-3 pr-6">
            <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
              <Sparkles size={16} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground mb-0.5">
                Enhance your transcriptions with AI
              </p>
              <p className="text-[12px] text-muted-foreground mb-2">
                Automatically fix grammar, punctuation, and formatting as you speak.
              </p>
              <Button
                variant="default"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onEnableAiEnhancement}
              >
                Enable AI Enhancement
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
