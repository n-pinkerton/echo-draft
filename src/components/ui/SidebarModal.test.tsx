import { fireEvent, render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import SidebarModal from "./SidebarModal";

describe("SidebarModal", () => {
  it("exposes one current destination and visible focus-ring classes", () => {
    const onSectionChange = vi.fn();
    const { rerender } = render(
      <SidebarModal
        open={true}
        onOpenChange={vi.fn()}
        title="Settings"
        sidebarItems={[
          { id: "general", label: "Preferences", icon: Circle },
          { id: "hotkeys", label: "Shortcuts", icon: Circle },
        ]}
        activeSection="general"
        onSectionChange={onSectionChange}
      >
        <div>Content</div>
      </SidebarModal>
    );

    const preferences = screen.getByRole("button", { name: /Preferences/ });
    const shortcuts = screen.getByRole("button", { name: /Shortcuts/ });
    expect(preferences).toHaveAttribute("aria-current", "page");
    expect(shortcuts).not.toHaveAttribute("aria-current");
    expect(shortcuts.className).toContain("focus-visible:ring-2");

    fireEvent.click(shortcuts);
    expect(onSectionChange).toHaveBeenCalledWith("hotkeys");

    rerender(
      <SidebarModal
        open={true}
        onOpenChange={vi.fn()}
        title="Settings"
        sidebarItems={[
          { id: "general", label: "Preferences", icon: Circle },
          { id: "hotkeys", label: "Shortcuts", icon: Circle },
        ]}
        activeSection="hotkeys"
        onSectionChange={onSectionChange}
      >
        <div>Content</div>
      </SidebarModal>
    );
    expect(
      screen.getAllByRole("button").filter((button) => button.getAttribute("aria-current"))
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Shortcuts/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
