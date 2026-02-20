import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { useParakeetModels } from "./useParakeetModels";

function Harness({ enabled }: { enabled: boolean }) {
  const { models } = useParakeetModels({ enabled });
  return <div data-testid="models">{models.map((m) => m.model).join(",")}</div>;
}

describe("useParakeetModels", () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      listParakeetModels: vi.fn(),
    };
  });

  it("loads models when enabled", async () => {
    (window as any).electronAPI.listParakeetModels.mockResolvedValue({
      success: true,
      models: [{ model: "parakeet-1", downloaded: true }],
    });

    render(<Harness enabled={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("models").textContent).toContain("parakeet-1");
    });
  });
});

