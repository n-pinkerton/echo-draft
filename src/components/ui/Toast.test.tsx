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
  });
});
