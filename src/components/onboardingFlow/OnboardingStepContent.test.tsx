import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingStepContent } from "./OnboardingStepContent";

vi.mock("../AuthenticationStep", () => ({
  default: ({ onContinueWithoutAccount, onAuthComplete, onNeedsVerification }: any) => (
    <div>
      <div>AUTH_STEP</div>
      <button onClick={() => onContinueWithoutAccount()}>CONTINUE_NO_ACCOUNT</button>
      <button onClick={() => onAuthComplete()}>AUTH_COMPLETE</button>
      <button onClick={() => onNeedsVerification("user@example.com")}>NEEDS_VERIFICATION</button>
    </div>
  ),
}));

vi.mock("../EmailVerificationStep", () => ({
  default: ({ email, onVerified }: any) => (
    <div>
      <div>VERIFY_STEP:{email}</div>
      <button onClick={() => onVerified()}>VERIFIED</button>
    </div>
  ),
}));

vi.mock("./SignedInSetupStep", () => ({
  SignedInSetupStep: () => <div>SIGNEDIN_SETUP</div>,
}));

vi.mock("./GuestSetupStep", () => ({
  GuestSetupStep: () => <div>GUEST_SETUP</div>,
}));

vi.mock("./PermissionsStep", () => ({
  OnboardingPermissionsStep: () => <div>PERMISSIONS_STEP</div>,
}));

vi.mock("./ActivationStep", () => ({
  OnboardingActivationStep: ({ hotkey }: any) => <div>ACTIVATION_STEP:{hotkey}</div>,
}));

const makeProps = (overrides: Partial<Parameters<typeof OnboardingStepContent>[0]> = {}) => {
  const nextStep = vi.fn();
  const setPendingVerificationEmail = vi.fn();
  const onContinueWithoutAccount = vi.fn();

  const props: Parameters<typeof OnboardingStepContent>[0] = {
    currentStep: 0,
    isSignedIn: false,
    skipAuth: false,
    pendingVerificationEmail: null,
    setPendingVerificationEmail,
    nextStep,
    permissions: {
      micPermissionGranted: false,
      accessibilityPermissionGranted: false,
      micPermissionError: null,
      isCheckingPasteTools: false,
      pasteToolsInfo: null,
      requestMicPermission: vi.fn(),
      testAccessibilityPermission: vi.fn(),
      openAccessibilitySettings: vi.fn(),
      openSoundInputSettings: vi.fn(),
      openMicPrivacySettings: vi.fn(),
      openPasteToolsInstallPage: vi.fn(),
      checkPasteToolsAvailability: vi.fn(),
    } as any,
    signedInSetup: {
      preferredLanguage: "auto",
      onPreferredLanguageChange: vi.fn(),
    },
    guestSetup: {
      transcriptionPickerProps: {} as any,
      preferredLanguage: "auto",
      onPreferredLanguageChange: vi.fn(),
    },
    activation: {
      hotkey: "CTRL+K",
      onHotkeyChange: vi.fn(async () => {}),
      isHotkeyRegistering: false,
      validateHotkey: vi.fn(),
      activationMode: "tap",
      setActivationMode: vi.fn(),
      isUsingGnomeHotkeys: false,
      readableHotkey: "Ctrl+K",
    },
    onContinueWithoutAccount,
    ...overrides,
  };

  return { props, nextStep, setPendingVerificationEmail, onContinueWithoutAccount };
};

describe("OnboardingStepContent", () => {
  it("renders auth when no pending verification email", () => {
    const { props } = makeProps({ currentStep: 0, pendingVerificationEmail: null });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("AUTH_STEP")).toBeInTheDocument();
  });

  it("renders verification and advances on verified", () => {
    const { props, nextStep, setPendingVerificationEmail } = makeProps({
      currentStep: 0,
      pendingVerificationEmail: "user@example.com",
    });
    render(<OnboardingStepContent {...props} />);

    expect(screen.getByText("VERIFY_STEP:user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByText("VERIFIED"));
    expect(setPendingVerificationEmail).toHaveBeenCalledWith(null);
    expect(nextStep).toHaveBeenCalled();
  });

  it("renders signed-in setup at step 1 when signed in", () => {
    const { props } = makeProps({ currentStep: 1, isSignedIn: true, skipAuth: false });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("SIGNEDIN_SETUP")).toBeInTheDocument();
  });

  it("renders guest setup at step 1 when not signed in", () => {
    const { props } = makeProps({ currentStep: 1, isSignedIn: false, skipAuth: true });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("GUEST_SETUP")).toBeInTheDocument();
  });

  it("renders activation at step 2 for signed-in flow", () => {
    const { props } = makeProps({ currentStep: 2, isSignedIn: true, skipAuth: false });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("ACTIVATION_STEP:CTRL+K")).toBeInTheDocument();
  });

  it("renders permissions at step 2 for guest flow", () => {
    const { props } = makeProps({ currentStep: 2, isSignedIn: false, skipAuth: true });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("PERMISSIONS_STEP")).toBeInTheDocument();
  });

  it("renders activation at step 3", () => {
    const { props } = makeProps({ currentStep: 3, isSignedIn: false, skipAuth: true });
    render(<OnboardingStepContent {...props} />);
    expect(screen.getByText("ACTIVATION_STEP:CTRL+K")).toBeInTheDocument();
  });
});

