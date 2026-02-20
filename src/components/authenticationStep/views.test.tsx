import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthNotConfiguredView } from "./AuthNotConfiguredView";
import { PasswordFormView } from "./PasswordFormView";
import { SignedInView } from "./SignedInView";
import { WelcomeView } from "./WelcomeView";

describe("AuthenticationStep views", () => {
  it("AuthNotConfiguredView calls continue handler", async () => {
    const user = userEvent.setup();
    const onContinueWithoutAccount = vi.fn();
    render(<AuthNotConfiguredView onContinueWithoutAccount={onContinueWithoutAccount} />);

    await user.click(screen.getByRole("button", { name: /get started/i }));
    expect(onContinueWithoutAccount).toHaveBeenCalledTimes(1);
  });

  it("SignedInView greets user and calls continue handler", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<SignedInView userName="Nigel" onContinue={onContinue} />);

    expect(screen.getByText(/welcome back/i)).toHaveTextContent("Nigel");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("PasswordFormView calls forgot and toggle handlers", async () => {
    const user = userEvent.setup();
    const onForgotPassword = vi.fn();
    const onToggleAuthMode = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    render(
      <PasswordFormView
        email="nigel@example.com"
        authMode="sign-in"
        fullName=""
        setFullName={() => {}}
        password="secret"
        setPassword={() => {}}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
        onBack={() => {}}
        onForgotPassword={onForgotPassword}
        onToggleAuthMode={onToggleAuthMode}
      />
    );

    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(onToggleAuthMode).toHaveBeenCalledTimes(1);
  });

  it("WelcomeView disables email submit until an email is present", async () => {
    const user = userEvent.setup();

    const onEmailContinue = vi.fn();
    const { rerender } = render(
      <WelcomeView
        email=""
        setEmail={() => {}}
        error={null}
        isSocialLoading={null}
        isCheckingEmail={false}
        onSocialSignIn={() => {}}
        onEmailContinue={onEmailContinue}
        onContinueWithoutAccount={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /continue with email/i })).toBeDisabled();

    rerender(
      <WelcomeView
        email="nigel@example.com"
        setEmail={() => {}}
        error={null}
        isSocialLoading={null}
        isCheckingEmail={false}
        onSocialSignIn={() => {}}
        onEmailContinue={onEmailContinue}
        onContinueWithoutAccount={() => {}}
      />
    );

    await user.click(screen.getByRole("button", { name: /continue with email/i }));
    expect(onEmailContinue).toHaveBeenCalled();
  });
});
