import { AlertCircle, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PasswordFormView({
  email,
  authMode,
  fullName,
  setFullName,
  password,
  setPassword,
  isSubmitting,
  error,
  onSubmit,
  onBack,
  onForgotPassword,
  onToggleAuthMode,
}: {
  email: string;
  authMode: "sign-in" | "sign-up";
  fullName: string;
  setFullName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (event: React.FormEvent) => void;
  onBack: () => void;
  onForgotPassword: () => void;
  onToggleAuthMode: () => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
      >
        <ChevronLeft className="w-3 h-3" />
        Back
      </button>

      <div className="text-center mb-4">
        <p className="text-sm text-muted-foreground/70 mb-2 leading-tight">{email}</p>
        <p className="text-lg font-semibold text-foreground tracking-tight leading-tight">
          {authMode === "sign-in" ? "Welcome back" : "Create your account"}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-2">
        {authMode === "sign-up" && (
          <Input
            type="text"
            placeholder="Enter your full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-9 text-xs"
            disabled={isSubmitting}
            autoFocus
          />
        )}
        <Input
          type="password"
          placeholder={authMode === "sign-up" ? "Create a password" : "Enter your password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9 text-xs"
          required
          minLength={authMode === "sign-up" ? 8 : undefined}
          disabled={isSubmitting}
          autoFocus={authMode === "sign-in"}
        />

        {authMode === "sign-up" && (
          <p className="text-[9px] text-muted-foreground/70 leading-tight">
            Password must be at least 8 characters
          </p>
        )}

        {authMode === "sign-in" && (
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-[10px] text-primary hover:text-primary/80 transition-colors text-left"
            disabled={isSubmitting}
          >
            Forgot password?
          </button>
        )}

        {error && (
          <div className="px-2.5 py-1.5 rounded bg-destructive/5 border border-destructive/20 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 text-destructive shrink-0" />
            <p className="text-[10px] text-destructive leading-snug">{error}</p>
          </div>
        )}

        <Button type="submit" disabled={isSubmitting || !password} className="w-full h-9">
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-sm font-medium">
                {authMode === "sign-in" ? "Signing in..." : "Creating account..."}
              </span>
            </>
          ) : (
            <span className="text-sm font-medium">
              {authMode === "sign-in" ? "Sign In" : "Create Account"}
            </span>
          )}
        </Button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={onToggleAuthMode}
          className="text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
          disabled={isSubmitting}
        >
          {authMode === "sign-in" ? (
            <>
              New here? <span className="font-medium text-primary">Create account</span>
            </>
          ) : (
            <>
              Have an account? <span className="font-medium text-primary">Sign in</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

