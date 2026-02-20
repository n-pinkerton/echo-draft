import AuthenticationStep from "../AuthenticationStep";
import EmailVerificationStep from "../EmailVerificationStep";
import type { UsePermissionsReturn } from "../../hooks/usePermissions";
import type { ComponentProps } from "react";
import type { default as TranscriptionModelPicker } from "../TranscriptionModelPicker";
import { SignedInSetupStep } from "./SignedInSetupStep";
import { GuestSetupStep } from "./GuestSetupStep";
import { OnboardingPermissionsStep } from "./PermissionsStep";
import { OnboardingActivationStep } from "./ActivationStep";

type TranscriptionPickerProps = Omit<ComponentProps<typeof TranscriptionModelPicker>, "variant">;

type OnboardingStepContentProps = {
  currentStep: number;
  isSignedIn: boolean;
  skipAuth: boolean;
  pendingVerificationEmail: string | null;
  setPendingVerificationEmail: (value: string | null) => void;
  nextStep: () => void;
  permissions: UsePermissionsReturn;
  signedInSetup: {
    preferredLanguage: string;
    onPreferredLanguageChange: (value: string) => void;
  };
  guestSetup: {
    transcriptionPickerProps: TranscriptionPickerProps;
    preferredLanguage: string;
    onPreferredLanguageChange: (value: string) => void;
  };
  activation: {
    hotkey: string;
    onHotkeyChange: (hotkey: string) => Promise<void>;
    isHotkeyRegistering: boolean;
    validateHotkey: (hotkey: string) => string | null | undefined;
    activationMode: "tap" | "push";
    setActivationMode: (mode: "tap" | "push") => void;
    isUsingGnomeHotkeys: boolean;
    readableHotkey: string;
  };
  onContinueWithoutAccount: () => void;
};

export const OnboardingStepContent = ({
  currentStep,
  isSignedIn,
  skipAuth,
  pendingVerificationEmail,
  setPendingVerificationEmail,
  nextStep,
  permissions,
  signedInSetup,
  guestSetup,
  activation,
  onContinueWithoutAccount,
}: OnboardingStepContentProps) => {
  switch (currentStep) {
    case 0:
      if (pendingVerificationEmail) {
        return (
          <EmailVerificationStep
            email={pendingVerificationEmail}
            onVerified={() => {
              setPendingVerificationEmail(null);
              nextStep();
            }}
          />
        );
      }

      return (
        <AuthenticationStep
          onContinueWithoutAccount={onContinueWithoutAccount}
          onAuthComplete={() => {
            nextStep();
          }}
          onNeedsVerification={(email) => {
            setPendingVerificationEmail(email);
          }}
        />
      );

    case 1:
      if (isSignedIn && !skipAuth) {
        return (
          <SignedInSetupStep
            preferredLanguage={signedInSetup.preferredLanguage}
            onPreferredLanguageChange={signedInSetup.onPreferredLanguageChange}
            permissions={permissions}
          />
        );
      }

      return (
        <GuestSetupStep
          transcriptionPickerProps={guestSetup.transcriptionPickerProps}
          preferredLanguage={guestSetup.preferredLanguage}
          onPreferredLanguageChange={guestSetup.onPreferredLanguageChange}
        />
      );

    case 2:
      if (isSignedIn && !skipAuth) {
        return <OnboardingActivationStep {...activation} />;
      }
      return <OnboardingPermissionsStep permissions={permissions} />;

    case 3:
      return <OnboardingActivationStep {...activation} />;

    default:
      return null;
  }
};
