import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DictionaryAddWordPanel from "./DictionaryAddWordPanel";

describe("DictionaryAddWordPanel", () => {
  it("labels the input and explains why a multiword entry cannot be added", () => {
    const onAddWord = vi.fn();
    render(
      <DictionaryAddWordPanel
        newWord="Dr. Martinez"
        onNewWordChange={vi.fn()}
        onAddWord={onAddWord}
      />
    );

    const input = screen.getByRole("textbox", { name: "Add a dictionary term" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/one word.*enter one term without spaces/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/add each distinctive word separately/i);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddWord).not.toHaveBeenCalled();
  });

  it("allows a valid single lexical term", () => {
    const onAddWord = vi.fn();
    render(
      <DictionaryAddWordPanel
        newWord="Martinez"
        onNewWordChange={vi.fn()}
        onAddWord={onAddWord}
      />
    );

    const input = screen.getByRole("textbox", { name: "Add a dictionary term" });
    expect(input).toHaveAttribute("placeholder", "e.g. EchoDraft, Kubernetes, Martinez");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddWord).toHaveBeenCalledOnce();
  });
});
