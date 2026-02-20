import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ControlPanel from "./components/ControlPanel.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import OnboardingFlow from "./components/OnboardingFlow.tsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { bootstrapDebugTelemetry } from "./bootstrap/debugTelemetry";
import { handleOAuthBrowserRedirect } from "./bootstrap/oauthBrowserRedirect";
import { useTheme } from "./hooks/useTheme";
import "./index.css";

let root = null;

if (!handleOAuthBrowserRedirect()) {
  void bootstrapDebugTelemetry();
  mountApp();
}

export function AppRouter() {
  // Initialize theme system
  useTheme();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check if this is the control panel window
  const isControlPanel =
    window.location.pathname.includes("control") || window.location.search.includes("panel=true");

  // Check if this is the dictation panel (main app)
  const isDictationPanel = !isControlPanel;

  useEffect(() => {
    // Check if onboarding has been completed
    const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
    const skipAuth =
      localStorage.getItem("skipAuth") === "true" ||
      localStorage.getItem("authenticationSkipped") === "true";
    const signedIn = localStorage.getItem("isSignedIn") === "true";
    const activationStepIndex = signedIn && !skipAuth ? 2 : 3;

    const rawStep = parseInt(localStorage.getItem("onboardingCurrentStep") || "0");
    const currentStep = Math.max(0, Math.min(rawStep, activationStepIndex));

    if (isControlPanel && !onboardingCompleted) {
      // Show onboarding for control panel if not completed
      setShowOnboarding(true);
    }

    // Hide dictation panel window unless onboarding is complete or we're past the permissions step
    if (isDictationPanel && !onboardingCompleted && currentStep < activationStepIndex) {
      window.electronAPI?.hideWindow?.();
    }

    setIsLoading(false);
  }, [isControlPanel, isDictationPanel]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem("onboardingCompleted", "true");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading EchoDraft...</p>
        </div>
      </div>
    );
  }

  if (isControlPanel && showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

  return isControlPanel ? <ControlPanel /> : <App />;
}

function mountApp() {
  if (!root) {
    root = ReactDOM.createRoot(document.getElementById("root"));
  }
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ToastProvider>
          <AppRouter />
        </ToastProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
