import React from "react";
import { AlertTriangle } from "lucide-react";

import { formatHotkeyLabel } from "../../utils/hotkeys";
import { useHotkeyCapture } from "./hotkeyInput/useHotkeyCapture";

export interface HotkeyInputProps {
  value: string;
  onChange: (hotkey: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  validate?: (hotkey: string) => string | null | undefined;
  captureTarget?: "insert" | "clipboard";
}

export interface HotkeyInputVariant {
  variant?: "default" | "hero";
}

export function HotkeyInput({
  value,
  onChange,
  onBlur,
  disabled = false,
  autoFocus = false,
  variant = "default",
  validate,
  captureTarget = "insert",
}: HotkeyInputProps & HotkeyInputVariant) {
  const {
    activeModifiers,
    containerRef,
    handleBlur,
    handleFocus,
    handleKeyDown,
    handleKeyUp,
    isCapturing,
    isFnHeld,
    isMac,
    validationWarning,
  } = useHotkeyCapture({
    autoFocus,
    captureTarget,
    disabled,
    onBlur,
    onChange,
    validate,
  });

  const displayValue = formatHotkeyLabel(value);
  const isGlobe = value === "GLOBE";
  const hotkeyParts = value?.includes("+") ? displayValue.split("+") : [];

  // Hero variant: large centered key display for onboarding
  if (variant === "hero") {
    return (
      <div
        ref={containerRef}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label="Press a key combination to set hotkey"
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={`
          relative group flex flex-col items-center justify-center py-4 px-5 min-h-28
          rounded-md border cursor-pointer select-none outline-none
          transition-all duration-150
          ${
            disabled
              ? "bg-muted/30 border-border cursor-not-allowed opacity-50"
              : isCapturing
                ? "bg-primary/5 border-primary/30 shadow-[0_0_0_2px_rgba(37,99,212,0.1)]"
                : "bg-surface-1 border-border hover:border-border-hover hover:bg-surface-2"
          }
        `}
      >
        {/* Recording state */}
        {isCapturing ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span className="text-xs font-medium text-primary">Listening...</span>
            </div>
            {activeModifiers.size > 0 ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  {Array.from(activeModifiers).map((mod) => (
                    <kbd
                      key={mod}
                      className="px-2.5 py-1 bg-primary/10 border border-primary/20 rounded-sm text-xs font-semibold text-primary"
                    >
                      {mod}
                    </kbd>
                  ))}
                  <span className="text-primary/50 text-sm font-medium">+</span>
                </div>
                {isFnHeld && (
                  <span className="text-[10px] text-muted-foreground">
                    Press a key to combine, or release for Globe
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                {isMac ? "Press any key or ⌘⇧K" : "Press any key or Ctrl+Shift+K"}
              </span>
            )}
            {validationWarning && (
              <div className="flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-md bg-warning/8 border border-warning/20 dark:bg-warning/12 dark:border-warning/25">
                <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                <span className="text-[11px] text-warning dark:text-amber-400">
                  {validationWarning}
                </span>
              </div>
            )}
          </div>
        ) : value ? (
          /* Has value: show the hotkey prominently */
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              {hotkeyParts.length > 0 ? (
                hotkeyParts.map((part, i) => (
                  <React.Fragment key={part}>
                    {i > 0 && (
                      <span className="text-muted-foreground/40 text-lg font-light">+</span>
                    )}
                    <kbd className="px-3 py-1.5 bg-surface-raised border border-border rounded-sm text-sm font-semibold text-foreground shadow-sm">
                      {part}
                    </kbd>
                  </React.Fragment>
                ))
              ) : isGlobe ? (
                <kbd className="px-3 py-1.5 bg-surface-raised border border-border rounded-sm text-lg shadow-sm">
                  🌐
                </kbd>
              ) : (
                <kbd className="px-3 py-1.5 bg-surface-raised border border-border rounded-sm text-sm font-semibold text-foreground shadow-sm">
                  {displayValue}
                </kbd>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
              Click to change
            </span>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <span className="text-sm font-medium">Click to set hotkey</span>
          </div>
        )}
      </div>
    );
  }

  // Default variant: compact inline display
  return (
    <div
      ref={containerRef}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-label="Press a key combination to set hotkey"
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={`
        relative overflow-hidden rounded-md border
        transition-all duration-150 cursor-pointer select-none focus:outline-none
        ${
          disabled
            ? "bg-muted/30 border-border cursor-not-allowed opacity-50"
            : isCapturing
              ? "bg-primary/5 border-primary/30 shadow-[0_0_0_2px_rgba(37,99,212,0.1)]"
              : "bg-surface-1 border-border hover:border-border-hover hover:bg-surface-2"
        }
      `}
    >
      {isCapturing && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary animate-pulse" />
      )}

      <div className="px-4 py-3">
        {isCapturing ? (
          <>
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                <span className="text-xs font-medium text-muted-foreground">Recording</span>
              </div>
              {activeModifiers.size > 0 ? (
                <div className="flex items-center gap-1">
                  {Array.from(activeModifiers).map((mod) => (
                    <kbd
                      key={mod}
                      className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-sm text-[11px] font-semibold text-primary"
                    >
                      {mod}
                    </kbd>
                  ))}
                  <span className="text-primary/40 text-[11px]">
                    {isFnHeld ? "+ key or release for Globe" : "+ key"}
                  </span>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {isMac ? "Try ⌘⇧K" : "Try Ctrl+Shift+K"}
                </span>
              )}
            </div>
            {validationWarning && (
              <div className="flex items-center gap-1.5 mt-1.5 px-3 py-1.5 rounded-md bg-warning/8 border border-warning/20 dark:bg-warning/12 dark:border-warning/25">
                <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                <span className="text-[11px] text-warning dark:text-amber-400">
                  {validationWarning}
                </span>
              </div>
            )}
          </>
        ) : value ? (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">Hotkey</span>
            <div className="flex items-center gap-2">
              {hotkeyParts.length > 0 ? (
                <div className="flex items-center gap-1">
                  {hotkeyParts.map((part, i) => (
                    <React.Fragment key={part}>
                      {i > 0 && <span className="text-muted-foreground/30 text-[10px]">+</span>}
                      <kbd className="px-2 py-0.5 bg-surface-raised border border-border rounded-sm text-xs font-semibold text-foreground">
                        {part}
                      </kbd>
                    </React.Fragment>
                  ))}
                </div>
              ) : isGlobe ? (
                <div className="flex items-center gap-1.5">
                  <kbd className="px-2 py-0.5 bg-surface-raised border border-border rounded-sm text-base">
                    🌐
                  </kbd>
                  <span className="text-[11px] text-muted-foreground">Globe</span>
                </div>
              ) : (
                <kbd className="px-2.5 py-1 bg-surface-raised border border-border rounded-sm text-xs font-semibold text-foreground">
                  {displayValue}
                </kbd>
              )}
              <span className="text-[10px] text-muted-foreground/50">click to change</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <span className="text-sm font-medium">Click to set hotkey</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default HotkeyInput;

