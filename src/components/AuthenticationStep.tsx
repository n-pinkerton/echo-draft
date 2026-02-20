import React, { useCallback, useEffect, useState, useRef } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  authClient,
  NEON_AUTH_URL,
  signInWithSocial,
  updateLastSignInTime,
  type SocialProvider,
} from "../lib/neonAuth";
import { OPENWHISPR_API_URL } from "../config/constants";
import logger from "../utils/logger";
import ForgotPasswordView from "./ForgotPasswordView";
import ResetPasswordView from "./ResetPasswordView";
import { AuthNotConfiguredView } from "./authenticationStep/AuthNotConfiguredView";
import { PasswordFormView } from "./authenticationStep/PasswordFormView";
import { SignedInView } from "./authenticationStep/SignedInView";
import { WelcomeView } from "./authenticationStep/WelcomeView";

interface AuthenticationStepProps {
  onContinueWithoutAccount: () => void;
  onAuthComplete: () => void;
  onNeedsVerification: (email: string) => void;
}

type AuthMode = "sign-in" | "sign-up" | null;
type PasswordResetView = "forgot" | "reset" | null;

export default function AuthenticationStep({
  onContinueWithoutAccount,
  onAuthComplete,
  onNeedsVerification,
}: AuthenticationStepProps) {
  const { isSignedIn, isLoaded, user } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordResetView, setPasswordResetView] = useState<PasswordResetView>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const oauthProcessedRef = useRef(false);
  const resetProcessedRef = useRef(false);
  const needsVerificationRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasVerifier = params.has("neon_auth_session_verifier");
    const token = params.get("token");
    const isResetPassword = params.has("reset_password");

    if (token && isResetPassword && !resetProcessedRef.current) {
      resetProcessedRef.current = true;
      setResetToken(token);
      setPasswordResetView("reset");
      logger.debug("Password reset token detected, showing reset form", undefined, "auth");
      return;
    }

    if (hasVerifier && !oauthProcessedRef.current) {
      oauthProcessedRef.current = true;
      setIsSocialLoading("google");

      // Grace period: session cookies take ~10-15s to establish after OAuth
      updateLastSignInTime();
      logger.debug("OAuth callback detected, grace period active", undefined, "auth");
    }
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn && !needsVerificationRef.current) {
      if (OPENWHISPR_API_URL && user?.id && user?.email) {
        fetch(`${OPENWHISPR_API_URL}/api/auth/init-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            email: user.email,
            name: user.name || null,
          }),
        }).catch((err) => logger.error("Failed to init user", err, "auth"));
      }
      onAuthComplete();
    }
  }, [isLoaded, isSignedIn, onAuthComplete, user?.email, user?.id, user?.name]);

  useEffect(() => {
    if (isSocialLoading === null) return;

    let timeout: ReturnType<typeof setTimeout>;

    const handleFocus = () => {
      timeout = setTimeout(() => {
        setIsSocialLoading(null);
      }, 1000);
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearTimeout(timeout);
    };
  }, [isSocialLoading]);

  const handleSocialSignIn = useCallback(async (provider: SocialProvider) => {
    setIsSocialLoading(provider);
    setError(null);

    const result = await signInWithSocial(provider);

    if (result.error) {
      setError(result.error.message || `Failed to sign in with ${provider}`);
      setIsSocialLoading(null);
    }
  }, []);

  const handleEmailContinue = useCallback(async () => {
    if (!email.trim() || !authClient) return;

    setIsCheckingEmail(true);
    setError(null);

    try {
      if (!OPENWHISPR_API_URL) {
        setAuthMode("sign-up");
        return;
      }

      const response = await fetch(`${OPENWHISPR_API_URL}/api/check-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to check user existence");
      }

      const data = await response.json().catch(() => ({}));
      setAuthMode(data.exists ? "sign-in" : "sign-up");
    } catch (err) {
      logger.error("Error checking user existence", err, "auth");
      setAuthMode("sign-up");
    } finally {
      setIsCheckingEmail(false);
    }
  }, [email]);

  const errorMessageIncludes = (message: string | undefined, keywords: string[]): boolean => {
    if (!message) return false;
    const lowerMessage = message.toLowerCase();
    return keywords.some((keyword) => lowerMessage.includes(keyword));
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!authClient) {
        setError("Authentication service is not configured. Please contact support.");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        if (authMode === "sign-up") {
          // Set before signup — SDK may trigger isSignedIn before returning
          needsVerificationRef.current = true;

          const result = await authClient.signUp.email({
            email: email.trim(),
            password,
            name: fullName.trim() || email.trim().split("@")[0],
          });

          if (result.error) {
            needsVerificationRef.current = false;
            if (
              errorMessageIncludes(result.error.message, ["already exists", "already registered"])
            ) {
              setAuthMode("sign-in");
              setError("Account exists. Please sign in.");
              setPassword("");
            } else {
              setError(result.error.message || "Failed to create account");
            }
          } else {
            updateLastSignInTime();

            if (OPENWHISPR_API_URL) {
              try {
                await fetch(`${OPENWHISPR_API_URL}/api/auth/init-user`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    userId: result.data?.user?.id,
                    email: email.trim(),
                    name: fullName.trim() || email.trim().split("@")[0],
                  }),
                });
              } catch (initErr) {
                logger.error("Failed to init user", initErr, "auth");
              }
            }

            onNeedsVerification(email.trim());
          }
        } else {
          const result = await authClient.signIn.email({
            email: email.trim(),
            password,
          });

          if (result.error) {
            if (errorMessageIncludes(result.error.message, ["not found", "no user"])) {
              setAuthMode("sign-up");
              setError("No account found. Let's create one.");
              setPassword("");
            } else {
              setError(result.error.message || "Invalid email or password");
            }
          } else {
            updateLastSignInTime();
            onAuthComplete();
          }
        }
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "An error occurred. Please try again.";
        setError(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
    },
    [authMode, email, fullName, password, onAuthComplete, onNeedsVerification]
  );

  const handleBack = useCallback(() => {
    setAuthMode(null);
    setPassword("");
    setFullName("");
    setError(null);
  }, []);

  const handleForgotPassword = useCallback(() => {
    setPasswordResetView("forgot");
    setError(null);
  }, []);

  const handleBackFromPasswordReset = useCallback(() => {
    setPasswordResetView(null);
    setResetToken(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    url.searchParams.delete("reset_password");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const toggleAuthMode = useCallback(() => {
    setAuthMode((mode) => (mode === "sign-in" ? "sign-up" : "sign-in"));
    setError(null);
    setPassword("");
    setFullName("");
  }, []);

  // Auth not configured state
  if (!NEON_AUTH_URL || !authClient) {
    return <AuthNotConfiguredView onContinueWithoutAccount={onContinueWithoutAccount} />;
  }

  // Already signed in state
  if (isLoaded && isSignedIn) {
    return <SignedInView userName={user?.name} onContinue={onAuthComplete} />;
  }

  // Password reset flow - show reset form if we have a token
  if (passwordResetView === "reset" && resetToken) {
    return (
      <ResetPasswordView
        token={resetToken}
        onSuccess={onAuthComplete}
        onBack={handleBackFromPasswordReset}
      />
    );
  }

  // Password reset flow - show forgot password form
  if (passwordResetView === "forgot") {
    return <ForgotPasswordView email={email} onBack={handleBackFromPasswordReset} />;
  }

  // Password form (after email is entered)
  if (authMode !== null) {
    return (
      <PasswordFormView
        email={email}
        authMode={authMode}
        fullName={fullName}
        setFullName={(value) => setFullName(value)}
        password={password}
        setPassword={(value) => setPassword(value)}
        isSubmitting={isSubmitting}
        error={error}
        onSubmit={handleSubmit}
        onBack={handleBack}
        onForgotPassword={handleForgotPassword}
        onToggleAuthMode={toggleAuthMode}
      />
    );
  }

  return (
    <WelcomeView
      email={email}
      setEmail={(value) => setEmail(value)}
      error={error}
      isSocialLoading={isSocialLoading}
      isCheckingEmail={isCheckingEmail}
      onSocialSignIn={() => handleSocialSignIn("google")}
      onEmailContinue={() => void handleEmailContinue()}
      onContinueWithoutAccount={onContinueWithoutAccount}
    />
  );
}
