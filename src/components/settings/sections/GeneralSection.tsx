import type { AlertDialogState, ConfirmDialogState } from "../../../hooks/useDialogs";

import AppearanceSection from "./general/AppearanceSection";
import LanguageSection from "./general/LanguageSection";
import MicrophoneSection from "./general/MicrophoneSection";
import SoundFeedbackSection from "./general/SoundFeedbackSection";
import StartupSection from "./general/StartupSection";
import UpdatesSection from "./general/UpdatesSection";

type Props = {
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function GeneralSection(props: Props) {
  const { showConfirmDialog, showAlertDialog } = props;

  return (
    <div className="space-y-6">
      <MicrophoneSection />
      <SoundFeedbackSection />
      <LanguageSection />
      <AppearanceSection />
      <StartupSection />
      <UpdatesSection showConfirmDialog={showConfirmDialog} showAlertDialog={showAlertDialog} />
    </div>
  );
}
