import type { CSSProperties } from "react";

export type MicState = "idle" | "hover" | "recording" | "processing";

export function getMicState({
  isRecording,
  isProcessing,
  isHovered,
}: {
  isRecording: boolean;
  isProcessing: boolean;
  isHovered: boolean;
}): MicState {
  if (isRecording) return "recording";
  if (isProcessing) return "processing";
  if (isHovered) return "hover";
  return "idle";
}

export function getMicButtonProps(micState: MicState): {
  className: string;
  tooltip: string;
  style?: CSSProperties;
} {
  const baseClasses =
    "rounded-full w-10 h-10 flex items-center justify-center relative overflow-hidden border-2 border-white/70 cursor-pointer";

  switch (micState) {
    case "idle":
    case "hover":
      return {
        className: `${baseClasses} bg-black/50 cursor-pointer`,
        tooltip: "Click to speak (Clipboard)",
      };
    case "recording":
      return {
        className: `${baseClasses} bg-primary cursor-pointer`,
        tooltip: "Recording...",
      };
    case "processing":
      return {
        className: `${baseClasses} bg-accent cursor-pointer`,
        tooltip: "Processing… (click to queue)",
      };
    default:
      return {
        className: `${baseClasses} bg-black/50 cursor-pointer`,
        style: { transform: "scale(0.8)" },
        tooltip: "Click to speak",
      };
  }
}

