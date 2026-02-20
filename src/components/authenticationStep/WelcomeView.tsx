import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import logoIcon from "../../assets/icon.png";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GoogleIcon } from "./GoogleIcon";

export function WelcomeView({
  email,
  setEmail,
  error,
  isSocialLoading,
  isCheckingEmail,
  onSocialSignIn,
  onEmailContinue,
  onContinueWithoutAccount,
}: {
  email: string;
  setEmail: (value: string) => void;
  error: string | null;
  isSocialLoading: "google" | null;
  isCheckingEmail: boolean;
  onSocialSignIn: () => void;
  onEmailContinue: () => void;
  onContinueWithoutAccount: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center mb-4">
        <img
          src={logoIcon}
          alt="EchoDraft"
          className="w-12 h-12 mx-auto mb-2.5 rounded-lg shadow-sm"
        />
        <p className="text-lg font-semibold text-foreground tracking-tight leading-tight">
          Welcome to EchoDraft
        </p>
        <p className="text-muted-foreground text-sm mt-1 leading-tight">
          Dictate anywhere using your voice
        </p>
      </div>

      <Button
        type="button"
        variant="social"
        onClick={onSocialSignIn}
        disabled={isSocialLoading !== null || isCheckingEmail}
        className="w-full h-9"
      >
        {isSocialLoading === "google" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Complete sign-in in your browser...
            </span>
          </>
        ) : (
          <>
            <GoogleIcon className="w-4 h-4" />
            <span className="text-sm font-medium">Continue with Google</span>
          </>
        )}
      </Button>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-[9px] font-medium text-muted-foreground/40 uppercase tracking-widest px-1">
          or
        </span>
        <div className="flex-1 h-px bg-border/50" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onEmailContinue();
        }}
        className="space-y-2"
      >
        <Input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 text-sm"
          required
          disabled={isSocialLoading !== null || isCheckingEmail}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!email.trim() || isSocialLoading !== null || isCheckingEmail}
          className="w-full h-9"
        >
          {isCheckingEmail ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <>
              <span className="text-sm font-medium">Continue with Email</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </Button>
      </form>

      {error && (
        <div className="px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="pt-1">
        <button
          type="button"
          onClick={onContinueWithoutAccount}
          className="w-full text-center text-xs text-muted-foreground/85 hover:text-foreground transition-colors py-1.5 rounded hover:bg-muted/30"
          disabled={isSocialLoading !== null || isCheckingEmail}
        >
          Continue without an account
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground/80 leading-tight text-center">
        By continuing, you agree to our{" "}
        <a
          href="https://openwhispr.com/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline decoration-link/30 hover:decoration-link/60 transition-colors"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://openwhispr.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline decoration-link/30 hover:decoration-link/60 transition-colors"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}

