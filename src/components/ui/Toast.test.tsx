import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "./Toast";
import { useToast } from "./toastContext";

function ToastHarness({ variant }: { variant: "default" | "destructive" }) {
  const { toast } = useToast();

  useEffect(() => {
    toast({ title: "Update Error", description: "The update failed.", variant, duration: 0 });
  }, [toast, variant]);

  return null;
}

function StackedToastHarness() {
  const { toast } = useToast();

  useEffect(() => {
    toast({
      title: "First background result",
      description: "The earlier dictation completed while the microphone stayed live.",
      duration: 0,
    });
    toast({
      title: "Second background result",
      description: "The next queued dictation is ready for delivery.",
      duration: 0,
    });
  }, [toast]);

  return null;
}

describe("Toast accessibility", () => {
  it("announces destructive toasts assertively as alerts", async () => {
    render(
      <ToastProvider>
        <ToastHarness variant="destructive" />
      </ToastProvider>
    );

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveAttribute("aria-live", "assertive");
    expect(toast).toHaveAttribute("aria-atomic", "true");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("stacks long dictation notices above the reserved status zone", async () => {
    render(
      <ToastProvider>
        <StackedToastHarness />
      </ToastProvider>
    );

    expect(await screen.findAllByRole("status")).toHaveLength(2);
    expect(screen.getByTestId("toast-viewport")).toHaveClass(
      "fixed",
      "bottom-20",
      "right-4",
      "items-end"
    );
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("keeps dismiss controls on interactive control-panel toasts", async () => {
    window.history.replaceState({}, "", "/?panel=true");
    try {
      render(
        <ToastProvider>
          <ToastHarness variant="default" />
        </ToastProvider>
      );

      expect(await screen.findByRole("button", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByTestId("toast-viewport")).toHaveClass("bottom-5", "right-5");
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});
