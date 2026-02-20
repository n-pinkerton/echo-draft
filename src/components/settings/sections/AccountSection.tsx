import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";
import { Progress } from "../../ui/progress";
import { SettingsRow } from "../../ui/SettingsSection";
import { Sparkles, LogOut, UserCircle } from "lucide-react";

import { useAuth } from "../../../hooks/useAuth";
import { useUsage } from "../../../hooks/useUsage";
import { useToast } from "../../ui/toastContext";
import type { AlertDialogState } from "../../../hooks/useDialogs";
import { NEON_AUTH_URL, signOut } from "../../../lib/neonAuth";
import { cn } from "../../lib/utils";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../SettingsPanels";
import logger from "../../../utils/logger";

type Props = {
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function AccountSection(props: Props) {
  const { showAlertDialog } = props;
  const { toast } = useToast();
  const usage = useUsage();
  const hasShownApproachingToast = useRef(false);
  const { isSignedIn, isLoaded, user } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (usage?.isApproachingLimit && !hasShownApproachingToast.current) {
      hasShownApproachingToast.current = true;
      toast({
        title: "Approaching Weekly Limit",
        description: `You've used ${usage.wordsUsed.toLocaleString()} of ${usage.limit.toLocaleString()} free words this week.`,
        duration: 6000,
      });
    }
  }, [toast, usage?.isApproachingLimit, usage?.limit, usage?.wordsUsed]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      localStorage.removeItem("onboardingCompleted");
      localStorage.removeItem("onboardingCurrentStep");
      window.location.reload();
    } catch (error) {
      logger.error("Sign out failed", error, "auth");
      showAlertDialog({
        title: "Sign Out Failed",
        description: "Unable to sign out. Please try again.",
      });
    } finally {
      setIsSigningOut(false);
    }
  }, [showAlertDialog]);

  return (
    <div className="space-y-5">
      {!NEON_AUTH_URL ? (
        <>
          <SectionHeader title="Account" description="Authentication is not configured" />
          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow
                label="Account Features Disabled"
                description="Set VITE_NEON_AUTH_URL in your .env file to enable account features."
              >
                <Badge variant="warning">Disabled</Badge>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>
        </>
      ) : isLoaded && isSignedIn && user ? (
        <>
          <SectionHeader title="Account" />
          <SettingsPanel>
            <SettingsPanelRow>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden bg-primary/10 dark:bg-primary/15">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name || "User"}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <UserCircle className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground truncate">
                    {user.name || "User"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                </div>
                <Badge variant="success">Signed in</Badge>
              </div>
            </SettingsPanelRow>
          </SettingsPanel>

          <SectionHeader title="Plan" />
          {!usage || !usage.hasLoaded ? (
            <SettingsPanel>
              <SettingsPanelRow>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </SettingsPanelRow>
              <SettingsPanelRow>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-8 w-full rounded" />
                </div>
              </SettingsPanelRow>
            </SettingsPanel>
          ) : (
            <SettingsPanel>
              <SettingsPanelRow>
                <SettingsRow
                  label={usage.isSubscribed ? (usage.isTrial ? "Trial" : "Pro") : "Free"}
                  description={
                    usage.isTrial
                      ? `${usage.trialDaysLeft} ${usage.trialDaysLeft === 1 ? "day" : "days"} remaining — unlimited transcriptions`
                      : usage.isSubscribed
                        ? usage.currentPeriodEnd
                          ? `Next billing: ${new Date(usage.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : "Unlimited transcriptions"
                        : `${usage.wordsUsed.toLocaleString()} / ${usage.limit.toLocaleString()} words this week`
                  }
                >
                  {usage.isTrial ? (
                    <Badge variant="info">Trial</Badge>
                  ) : usage.isSubscribed ? (
                    <Badge variant="success">Pro</Badge>
                  ) : usage.isOverLimit ? (
                    <Badge variant="warning">Limit reached</Badge>
                  ) : (
                    <Badge variant="outline">Free</Badge>
                  )}
                </SettingsRow>
              </SettingsPanelRow>

              {!usage.isSubscribed && !usage.isTrial && (
                <SettingsPanelRow>
                  <div className="space-y-1.5">
                    <Progress
                      value={usage.limit > 0 ? Math.min(100, (usage.wordsUsed / usage.limit) * 100) : 0}
                      className={cn(
                        "h-1.5",
                        usage.isOverLimit
                          ? "[&>div]:bg-destructive"
                          : usage.isApproachingLimit
                            ? "[&>div]:bg-warning"
                            : "[&>div]:bg-primary"
                      )}
                    />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {usage.wordsUsed.toLocaleString()} / {usage.limit.toLocaleString()}
                      </span>
                      {usage.isApproachingLimit && (
                        <span className="text-warning">
                          {usage.wordsRemaining.toLocaleString()} remaining
                        </span>
                      )}
                      {!usage.isApproachingLimit && !usage.isOverLimit && (
                        <span>Rolling weekly limit</span>
                      )}
                    </div>
                  </div>
                </SettingsPanelRow>
              )}

              <SettingsPanelRow>
                <Button
                  onClick={async () => {
                    const result = await window.electronAPI?.openExternal(
                      "https://github.com/n-pinkerton/echo-draft/releases"
                    );
                    if (!result?.success) {
                      toast({
                        title: "Couldn't open releases",
                        description: result?.error ?? "App not ready",
                        variant: "destructive",
                      });
                    }
                  }}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  Open Releases
                </Button>
              </SettingsPanelRow>
            </SettingsPanel>
          )}

          <SettingsPanel>
            <SettingsPanelRow>
              <Button
                onClick={handleSignOut}
                variant="outline"
                disabled={isSigningOut}
                size="sm"
                className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50"
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                {isSigningOut ? "Signing out..." : "Sign Out"}
              </Button>
            </SettingsPanelRow>
          </SettingsPanel>
        </>
      ) : isLoaded ? (
        <>
          <SectionHeader title="Account" />
          <SettingsPanel>
            <SettingsPanelRow>
              <SettingsRow
                label="Not Signed In"
                description="Create an account to unlock premium features."
              >
                <Badge variant="outline">Offline</Badge>
              </SettingsRow>
            </SettingsPanelRow>
          </SettingsPanel>

          <div className="rounded-lg border border-primary/20 dark:border-primary/15 bg-primary/3 dark:bg-primary/6 p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Try Pro free for 7 days</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    Unlimited transcriptions, priority processing, and more.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    localStorage.setItem("pendingCloudMigration", "true");
                    localStorage.removeItem("onboardingCompleted");
                    localStorage.setItem("onboardingCurrentStep", "0");
                    window.location.reload();
                  }}
                  size="sm"
                  className="w-full"
                >
                  <UserCircle className="mr-1.5 h-3.5 w-3.5" />
                  Create Free Account
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <SectionHeader title="Account" />
          <SettingsPanel>
            <SettingsPanelRow>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </SettingsPanelRow>
          </SettingsPanel>
        </>
      )}
    </div>
  );
}
