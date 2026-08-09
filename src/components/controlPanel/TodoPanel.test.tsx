import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodoItem } from "../../types/electron";
import TodoPanel from "./TodoPanel";

const makeItem = (id: number, text: string, title?: string, rawText?: string): TodoItem => ({
  id,
  text,
  ...(rawText !== undefined ? { raw_text: rawText } : {}),
  title: title || null,
  created_at: "2026-07-18 01:00:00",
});

describe("TodoPanel", () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      getArchivedTodos: vi.fn(async () => ({ items: [], nextCursor: null })),
    };
  });

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

  it("copies the stored raw transcript separately and does not invent one", async () => {
    const copyToClipboard = vi.fn(async () => {});
    render(
      <TodoPanel
        items={[
          makeItem(1, "Cleaned request", undefined, "clean request"),
          makeItem(2, "No raw copy"),
        ]}
        isLoading={false}
        copyToClipboard={copyToClipboard}
        markActioned={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy raw mobile memo 1" }));
    expect(copyToClipboard).toHaveBeenCalledWith(
      "clean request",
      expect.objectContaining({ title: "Raw Transcript Copied" })
    );
    expect(screen.getByRole("button", { name: "Raw mobile memo 2 unavailable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Raw mobile memo 2 unavailable" })).toHaveAttribute(
      "title",
      "Raw transcript was not stored"
    );
  });

  it("disables both To Do reprocessing actions when raw text is blank", () => {
    const reprocessItem = vi.fn(async () => {});
    render(
      <TodoPanel
        items={[makeItem(1, "Cleaned request", undefined, "   ")]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
        reprocessItem={reprocessItem}
      />
    );

    expect(screen.getByRole("button", { name: "Clean again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clean again" })).toHaveAttribute(
      "title",
      "Raw transcript is required to clean again"
    );
    expect(screen.getByRole("button", { name: "Make Codex prompt" })).toBeDisabled();
    expect(reprocessItem).not.toHaveBeenCalled();
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

  it("marks prompt-mode mobile dictations with an accessible icon", () => {
    render(
      <TodoPanel
        items={[{ ...makeItem(1, "Continue with the review"), processingMode: "codex-prompt" }]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );

    expect(screen.getByRole("img", { name: "Codex prompt" })).toBeInTheDocument();
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

  it("loads Archived with keyset paging, keeps copy/reprocessing, and never offers unarchive", async () => {
    const firstArchived = makeItem(10, "Archived first", "First", "raw first");
    const secondArchived = makeItem(9, "Archived second", "Second", "raw second");
    const getArchivedTodos = vi
      .fn()
      .mockResolvedValueOnce({
        items: [firstArchived],
        nextCursor: { sortEpoch: 1_752_800_000_000, id: 10 },
      })
      .mockResolvedValueOnce({ items: [secondArchived], nextCursor: null });
    window.electronAPI.getArchivedTodos = getArchivedTodos;
    const reprocessItem = vi.fn(async () => {});
    const setCorrectionFlag = vi.fn(async () => {});
    render(
      <TodoPanel
        items={[makeItem(1, "Pending item", undefined, "pending raw")]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
        reprocessItem={reprocessItem}
        setCorrectionFlag={setCorrectionFlag}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(await screen.findByText("Archived first")).toBeInTheDocument();
    expect(getArchivedTodos).toHaveBeenNthCalledWith(1, { query: "", cursor: null, limit: 25 });
    expect(
      screen.queryByRole("button", { name: /Mark mobile memo .* actioned/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy raw mobile memo 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clean again" }));
    await waitFor(() => expect(reprocessItem).toHaveBeenCalledWith(firstArchived, "cleanup"));
    fireEvent.change(screen.getByLabelText("Correction flag for mobile memo 1"), {
      target: { value: "prompt" },
    });
    await waitFor(() => expect(setCorrectionFlag).toHaveBeenCalledWith(firstArchived, "prompt"));

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Archived second")).toBeInTheDocument();
    expect(getArchivedTodos).toHaveBeenNthCalledWith(2, {
      query: "",
      cursor: { sortEpoch: 1_752_800_000_000, id: 10 },
      limit: 25,
    });
  });

  it("searches all Archived rows through a reset local database query", async () => {
    const getArchivedTodos = vi.fn(async ({ query }: { query: string }) => ({
      items: query === "needle" ? [makeItem(8, "Found in archived raw", "Result", "needle")] : [],
      nextCursor: null,
    }));
    window.electronAPI.getArchivedTodos = getArchivedTodos;
    render(
      <TodoPanel
        items={[]}
        isLoading={false}
        copyToClipboard={vi.fn(async () => {})}
        markActioned={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await waitFor(() =>
      expect(getArchivedTodos).toHaveBeenCalledWith({ query: "", cursor: null, limit: 25 })
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search Archived mobile To Do dictations" }),
      {
        target: { value: "needle" },
      }
    );

    expect(await screen.findByText("Found in archived raw")).toBeInTheDocument();
    expect(getArchivedTodos).toHaveBeenLastCalledWith({ query: "needle", cursor: null, limit: 25 });
  });
});
