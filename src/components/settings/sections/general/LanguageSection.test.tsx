import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LanguageSection from "./LanguageSection";

const useSettingsMock = vi.fn();

vi.mock("../../../../hooks/useSettings", () => ({
  useSettings: () => useSettingsMock(),
}));

vi.mock("../../../ui/LanguageSelector", () => ({
  default: (props: any) => (
    <button type="button" onClick={() => props.onChange("es")}>
      LanguageSelector({props.value})
    </button>
  ),
}));

describe("LanguageSection", () => {
  beforeEach(() => {
    useSettingsMock.mockReturnValue({
      preferredLanguage: "en",
      updateTranscriptionSettings: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates preferred language", async () => {
    const user = userEvent.setup();
    render(<LanguageSection />);

    await user.click(screen.getByRole("button", { name: "LanguageSelector(en)" }));

    const { updateTranscriptionSettings } = useSettingsMock.mock.results[0].value;
    expect(updateTranscriptionSettings).toHaveBeenCalledWith({ preferredLanguage: "es" });
  });
});

