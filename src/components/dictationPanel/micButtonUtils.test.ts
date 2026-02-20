import { describe, expect, it } from "vitest";
import { getMicButtonProps, getMicState } from "./micButtonUtils";

describe("micButtonUtils", () => {
  describe("getMicState", () => {
    it("prefers recording over all other states", () => {
      expect(getMicState({ isRecording: true, isProcessing: true, isHovered: true })).toBe(
        "recording"
      );
    });

    it("returns processing when processing and not recording", () => {
      expect(getMicState({ isRecording: false, isProcessing: true, isHovered: true })).toBe(
        "processing"
      );
    });

    it("returns hover when hovered and idle", () => {
      expect(getMicState({ isRecording: false, isProcessing: false, isHovered: true })).toBe(
        "hover"
      );
    });

    it("returns idle otherwise", () => {
      expect(getMicState({ isRecording: false, isProcessing: false, isHovered: false })).toBe(
        "idle"
      );
    });
  });

  describe("getMicButtonProps", () => {
    it("provides tooltip and classes for idle/hover", () => {
      expect(getMicButtonProps("idle").tooltip).toMatch(/Click to speak/i);
      expect(getMicButtonProps("hover").className).toMatch(/bg-black/);
    });

    it("provides tooltip for recording", () => {
      expect(getMicButtonProps("recording").tooltip).toMatch(/Recording/i);
    });

    it("provides tooltip for processing", () => {
      expect(getMicButtonProps("processing").tooltip).toMatch(/Processing/i);
    });
  });
});

