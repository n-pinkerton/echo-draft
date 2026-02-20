import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { useWhisperModels } from "./useWhisperModels";

function Harness({
  enabled,
  selectedModel,
  onSelectModel,
}: {
  enabled: boolean;
  selectedModel: string;
  onSelectModel: (id: string) => void;
}) {
  const { models } = useWhisperModels({ enabled, selectedModel, onSelectModel });
  return <div data-testid="models">{models.map((m) => m.model).join(",")}</div>;
}

describe("useWhisperModels", () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      listWhisperModels: vi.fn(),
    };
  });

  it("selects a downloaded model when the selected one is not downloaded", async () => {
    (window as any).electronAPI.listWhisperModels.mockResolvedValue({
      success: true,
      models: [
        { model: "tiny", downloaded: true },
        { model: "base", downloaded: false },
      ],
    });

    const onSelectModel = vi.fn();
    render(<Harness enabled={true} selectedModel="base" onSelectModel={onSelectModel} />);

    await waitFor(() => expect(onSelectModel).toHaveBeenCalledWith("tiny"));
  });

  it("clears selection when nothing is downloaded", async () => {
    (window as any).electronAPI.listWhisperModels.mockResolvedValue({
      success: true,
      models: [{ model: "base", downloaded: false }],
    });

    const onSelectModel = vi.fn();
    render(<Harness enabled={true} selectedModel="base" onSelectModel={onSelectModel} />);

    await waitFor(() => expect(onSelectModel).toHaveBeenCalledWith(""));
  });
});

