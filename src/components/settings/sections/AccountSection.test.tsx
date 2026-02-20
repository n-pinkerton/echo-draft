import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useAuthMock = vi.fn();
const useUsageMock = vi.fn();
const useToastMock = vi.fn();
const signOutMock = vi.fn(async () => {});

async function loadSubject(neonAuthUrl: string) {
  vi.resetModules();

  vi.doMock("../../../hooks/useAuth", () => ({
    useAuth: () => useAuthMock(),
  }));

  vi.doMock("../../../hooks/useUsage", () => ({
    useUsage: () => useUsageMock(),
  }));

  vi.doMock("../../ui/toastContext", () => ({
    useToast: () => useToastMock(),
  }));

  vi.doMock("../../../lib/neonAuth", () => ({
    NEON_AUTH_URL: neonAuthUrl,
    signOut: signOutMock,
  }));

  const module = await import("./AccountSection");
  return module.default;
}

describe("AccountSection", () => {
  beforeEach(() => {
    useToastMock.mockReturnValue({ toast: vi.fn() });
    useUsageMock.mockReturnValue({ hasLoaded: false });
    useAuthMock.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders disabled state when auth is not configured", async () => {
    const AccountSection = await loadSubject("");
    render(<AccountSection showAlertDialog={vi.fn()} />);
    expect(screen.getByText("Account Features Disabled")).toBeInTheDocument();
  });

  it("renders signed-in state when auth is configured", async () => {
    const AccountSection = await loadSubject("https://auth.example");

    useAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { name: "Test User", email: "test@example.com", image: null },
    });
    useUsageMock.mockReturnValue({
      hasLoaded: true,
      isSubscribed: true,
      isTrial: false,
      wordsUsed: 0,
      limit: 2000,
      wordsRemaining: 2000,
      isApproachingLimit: false,
      isOverLimit: false,
      currentPeriodEnd: null,
    });

    render(<AccountSection showAlertDialog={vi.fn()} />);

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });
});
