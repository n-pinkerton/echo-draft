import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LocalModelCard } from "./LocalModelCard";
import { MODEL_PICKER_COLORS } from "../../utils/modelPickerStyles";

describe("LocalModelCard", () => {
  it("selects the model when downloaded and not selected", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <LocalModelCard
        modelId="base"
        name="Base"
        description="Good balance"
        size="142MB"
        isSelected={false}
        isDownloaded
        isDownloading={false}
        isCancelling={false}
        provider="whisper"
        onSelect={onSelect}
        onDelete={vi.fn()}
        onDownload={vi.fn()}
        onCancel={vi.fn()}
        styles={MODEL_PICKER_COLORS.purple}
      />
    );

    await user.click(screen.getByText("Base"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onDownload when download button is pressed", async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();

    render(
      <LocalModelCard
        modelId="base"
        name="Base"
        description="Good balance"
        size="142MB"
        isSelected={false}
        isDownloaded={false}
        isDownloading={false}
        isCancelling={false}
        provider="whisper"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDownload={onDownload}
        onCancel={vi.fn()}
        styles={MODEL_PICKER_COLORS.purple}
      />
    );

    await user.click(screen.getByRole("button", { name: /download/i }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

