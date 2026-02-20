import { describe, expect, it } from "vitest";
import { getActivationStepIndex, getOnboardingSteps } from "./onboardingSteps";

describe("onboardingSteps", () => {
  it("returns signed-in flow steps", () => {
    const steps = getOnboardingSteps(true);
    expect(steps.map((step) => step.title)).toEqual(["Welcome", "Setup", "Activation"]);
    expect(getActivationStepIndex(true)).toBe(2);
  });

  it("returns guest flow steps", () => {
    const steps = getOnboardingSteps(false);
    expect(steps.map((step) => step.title)).toEqual([
      "Welcome",
      "Setup",
      "Permissions",
      "Activation",
    ]);
    expect(getActivationStepIndex(false)).toBe(3);
  });
});

