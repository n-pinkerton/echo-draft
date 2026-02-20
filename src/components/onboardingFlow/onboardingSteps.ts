import { Command, Settings, Shield, UserCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface OnboardingStepDefinition {
  title: string;
  icon: LucideIcon;
}

export const getOnboardingSteps = (isSignedInFlow: boolean): OnboardingStepDefinition[] => {
  if (isSignedInFlow) {
    return [
      { title: "Welcome", icon: UserCircle },
      { title: "Setup", icon: Settings },
      { title: "Activation", icon: Command },
    ];
  }

  return [
    { title: "Welcome", icon: UserCircle },
    { title: "Setup", icon: Settings },
    { title: "Permissions", icon: Shield },
    { title: "Activation", icon: Command },
  ];
};

export const getActivationStepIndex = (isSignedInFlow: boolean): number => {
  return isSignedInFlow ? 2 : 3;
};

