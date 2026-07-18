import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TodoItem } from "../../types/electron";
import TodoPanel from "./TodoPanel";

const makeItem = (id: number, text: string): TodoItem => ({
  id,
  text,
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
});
