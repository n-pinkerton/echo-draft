import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TodoItem } from "../../types/electron";
import TodoPanel from "./TodoPanel";

const makeItem = (id: number, text: string, title?: string): TodoItem => ({
  id,
  text,
  title: title || null,
  created_at: "2026-07-18 01:00:00",
});

describe("TodoPanel", () => {
  it("renders loading and empty states", () => {
    const { rerender } = render(
      <TodoPanel
        items={[]}
        isLoading
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    rerender(
      <TodoPanel
        items={[]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );
    expect(screen.getByText("Nothing to action")).toBeInTheDocument();
  });

  it("copies and actions a mobile memo", async () => {
    const copyToClipboard = vi.fn(async () => {});
    const markActioned = vi.fn(async () => {});
    render(
      <TodoPanel
        items={[makeItem(1, "Call the accountant"), makeItem(2, "Book the service")]}
        isLoading={false}
        copyToClipboard={copyToClipboard}
        markActioned={markActioned}
      />
    );

    expect(screen.getAllByTestId("todo-item")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Copy mobile memo 1" }));
    expect(copyToClipboard).toHaveBeenCalledWith("Call the accountant");

    fireEvent.click(screen.getByRole("button", { name: "Mark mobile memo 1 actioned" }));
    await waitFor(() => expect(markActioned).toHaveBeenCalledWith(1));
  });

  it("labels mobile dictations and searches by title", () => {
    render(
      <TodoPanel
        items={[
          makeItem(1, "Call Sam tomorrow", "Accountant follow-up"),
          makeItem(2, "Book the car service", "Vehicle maintenance"),
        ]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );

    expect(screen.getByRole("heading", { name: "Accountant follow-up" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search mobile To Do dictations" }), {
      target: { value: "vehicle maintenance" },
    });

    expect(screen.queryByText("Call Sam tomorrow")).not.toBeInTheDocument();
    expect(screen.getByText("Book the car service")).toBeInTheDocument();
  });

  it("announces loading and gives repeated controls distinct accessible names", () => {
    const { rerender } = render(
      <TodoPanel
        items={[]}
        isLoading
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");

    rerender(
      <TodoPanel
        items={[makeItem(1, "Call the accountant"), makeItem(2, "Book the service")]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );
    expect(screen.getByRole("button", { name: "Copy mobile memo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy mobile memo 2" })).toBeInTheDocument();
  });

  it("offers a simple mobile folder setup and shows the selected path", () => {
    const chooseMobileInboxFolder = vi.fn(async () => {});
    const { rerender } = render(
      <TodoPanel
        items={[]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
        mobileInboxStatus={{
          configured: false,
          folderPath: null,
          state: "not_configured",
        }}
        chooseMobileInboxFolder={chooseMobileInboxFolder}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(chooseMobileInboxFolder).toHaveBeenCalledOnce();

    rerender(
      <TodoPanel
        items={[]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
        mobileInboxStatus={{
          configured: true,
          folderPath: "C:/OneDrive/EchoDraft Mobile",
          state: "waiting",
        }}
        chooseMobileInboxFolder={chooseMobileInboxFolder}
      />
    );
    expect(screen.getByText("C:/OneDrive/EchoDraft Mobile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });
});
