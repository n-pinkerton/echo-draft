import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGoogleFont } from "./useGoogleFont";

function TestComponent({ href }: { href: string }) {
  useGoogleFont(href);
  return null;
}

describe("useGoogleFont", () => {
  it("adds and removes a stylesheet link", () => {
    const href = "https://fonts.googleapis.com/css2?family=Noto+Sans";
    expect(document.querySelector(`link[href="${href}"]`)).toBeNull();

    const { unmount } = render(<TestComponent href={href} />);
    expect(document.querySelector(`link[href="${href}"]`)).not.toBeNull();

    unmount();
    expect(document.querySelector(`link[href="${href}"]`)).toBeNull();
  });
});

