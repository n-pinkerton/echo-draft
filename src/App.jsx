import React, { useState, useEffect, useRef } from "react";
import "./index.css";
import { X } from "lucide-react";
import { useToast } from "./components/ui/Toast";
import { LoadingDots } from "./components/ui/LoadingDots";
import DictationStatusBar from "./components/ui/DictationStatusBar";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useAuth } from "./hooks/useAuth";

// Sound Wave Icon Component (for idle/hover states)
const SoundWaveIcon = ({ size = 16 }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
      <div className={`bg-white rounded-full`} style={{ width: size * 0.25, height: size }}></div>
      <div
        className={`bg-white rounded-full`}
        style={{ width: size * 0.25, height: size * 0.6 }}
      ></div>
    </div>
  );
};

// Voice Wave Animation Component (for processing state)
const VoiceWaveIndicator = ({ isListening }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-all duration-150 ${
            isListening ? "animate-pulse h-4" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
};

// Enhanced Tooltip Component
const Tooltip = ({ children, content, emoji }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && (
        <div
          className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-1 py-1 text-popover-foreground bg-popover border border-border rounded-md whitespace-nowrap z-10 transition-opacity duration-150 shadow-lg"
          style={{ fontSize: "9.7px", maxWidth: "96px" }}
        >
          {emoji && <span className="mr-1">{emoji}</span>}
          {content}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-popover"></div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const commandMenuRef = useRef(null);
  const buttonRef = useRef(null);
  const { toast, toastCount } = useToast();
  const { hotkey } = useHotkey();
  const { isDragging, handleMouseDown, handleMouseUp } = useWindowDrag();
  const { isSignedIn } = useAuth();

  const [dragStartPos, setDragStartPos] = useState(null);
  const [hasDragged, setHasDragged] = useState(false);

  const setWindowInteractivity = React.useCallback((shouldCapture) => {
    window.electronAPI?.setMainWindowInteractivity?.(shouldCapture);
  }, []);

  useEffect(() => {
    setWindowInteractivity(false);
    return () => setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      toast({
        title: "Hotkey Changed",
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      toast({
        title: "Hotkey Unavailable",
        description: `Could not register hotkey. Please set a different hotkey in Settings.`,
        duration: 10000,
      });
    });

    const unsubscribeWindowsPtt = window.electronAPI?.onWindowsPushToTalkUnavailable?.((data) => {
      const reason = typeof data?.reason === "string" ? data.reason : "";
      const message = typeof data?.message === "string" ? data.message : "";
      toast({
        title: "Windows Key Listener Unavailable",
        description:
          message ||
          (reason === "binary_not_found"
            ? "Push-to-Talk native listener is missing. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."
            : "Push-to-Talk native listener is unavailable. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."),
        duration: 12000,
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeWindowsPtt?.();
    };
  }, [toast]);

  useEffect(() => {
    if (isCommandMenuOpen || toastCount > 0) {
      setWindowInteractivity(true);
    } else if (!isHovered) {
      setWindowInteractivity(false);
    }
  }, [isCommandMenuOpen, isHovered, toastCount, setWindowInteractivity]);

  useEffect(() => {
    const resizeWindow = () => {
      if (isCommandMenuOpen && toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("EXPANDED");
      } else if (isCommandMenuOpen) {
        window.electronAPI?.resizeMainWindow?.("WITH_MENU");
      } else if (toastCount > 0) {
        window.electronAPI?.resizeMainWindow?.("WITH_TOAST");
      } else {
        window.electronAPI?.resizeMainWindow?.("WITH_STATUS");
      }
    };
    resizeWindow();
  }, [isCommandMenuOpen, toastCount]);

  const handleDictationToggle = React.useCallback(() => {
    setIsCommandMenuOpen(false);
    setWindowInteractivity(false);
  }, [setWindowInteractivity]);

  const {
    isRecording,
    isProcessing,
    progress,
    jobs,
    toggleListening,
    cancelRecording,
    cancelProcessing,
    warmupStreaming,
  } = useAudioRecording(toast, {
    onToggle: handleDictationToggle,
  });

  // Trigger streaming warmup when user signs in (covers first-time account creation)
  useEffect(() => {
    if (isSignedIn) {
      warmupStreaming();
    }
  }, [isSignedIn, warmupStreaming]);

  const handleClose = () => {
    window.electronAPI.hideWindow();
  };

  useEffect(() => {
    if (!isCommandMenuOpen) {
      return;
    }

    const handleClickOutside = (event) => {
      if (
        commandMenuRef.current &&
        !commandMenuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsCommandMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isCommandMenuOpen]);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        if (isCommandMenuOpen) {
          setIsCommandMenuOpen(false);
        } else {
          handleClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, [isCommandMenuOpen]);

  // Determine current mic state
  const getMicState = () => {
    if (isRecording) return "recording";
    if (isProcessing) return "processing";
    if (isHovered && !isRecording && !isProcessing) return "hover";
    return "idle";
  };

  const micState = getMicState();

  const getMicButtonProps = () => {
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
  };

  const micProps = getMicButtonProps();
  const visibleJobs = Array.isArray(jobs)
    ? jobs.filter((job) => job && typeof job === "object" && job.status !== "done")
    : [];
  const stackedJobs = visibleJobs.slice(-3).reverse();

  return (
    <div className="dictation-window">
      {/* Bottom-right voice button - window expands upward/leftward */}
      <div className="fixed bottom-4 right-4 z-50">
        <div className="flex flex-col items-end gap-2">
          <DictationStatusBar progress={progress} />

          <div
            className="relative flex items-center gap-2"
            onMouseEnter={() => {
              setIsHovered(true);
              setWindowInteractivity(true);
            }}
            onMouseLeave={() => {
              setIsHovered(false);
              if (!isCommandMenuOpen) {
                setWindowInteractivity(false);
              }
            }}
          >
            {(isRecording || isProcessing) && isHovered && (
              <button
                aria-label={isRecording ? "Cancel recording" : "Cancel processing"}
                onClick={(e) => {
                  e.stopPropagation();
                  isRecording ? cancelRecording() : cancelProcessing();
                }}
                className="group/cancel w-5 h-5 rounded-full bg-surface-2/90 hover:bg-destructive border border-border hover:border-destructive/70 flex items-center justify-center transition-all duration-150 shadow-sm backdrop-blur-sm"
              >
                <X
                  size={10}
                  strokeWidth={2.5}
                  className="text-foreground group-hover/cancel:text-destructive-foreground transition-colors duration-150"
                />
              </button>
            )}
            {visibleJobs.length > 1 ? (
              <div className="flex flex-col items-end gap-1 pr-0.5" aria-label="Dictation jobs">
                {stackedJobs.map((job) => {
                  const status = String(job.status || "");
                  const baseClass =
                    "h-4 w-4 rounded-full border text-[9px] font-semibold tabular-nums flex items-center justify-center";
                  const className =
                    status === "recording"
                      ? `${baseClass} bg-primary text-primary-foreground border-primary/70`
                      : status === "processing"
                        ? `${baseClass} bg-accent text-accent-foreground border-accent/70 animate-pulse`
                        : status === "queued"
                          ? `${baseClass} bg-muted text-muted-foreground border-border/70`
                          : status === "error"
                            ? `${baseClass} bg-destructive text-destructive-foreground border-destructive/70`
                            : `${baseClass} bg-muted text-muted-foreground border-border/70`;

                  return (
                    <div key={String(job.sessionId)} className={className}>
                      {job.jobId}
                    </div>
                  );
                })}
                {visibleJobs.length > 3 ? (
                  <div className="h-4 w-4 rounded-full border border-border/70 bg-muted text-[8px] font-semibold tabular-nums flex items-center justify-center text-muted-foreground">
                    +{visibleJobs.length - 3}
                  </div>
                ) : null}
              </div>
            ) : null}
            <Tooltip content={micProps.tooltip}>
              <button
                ref={buttonRef}
                onMouseDown={(e) => {
                  setIsCommandMenuOpen(false);
                  setDragStartPos({ x: e.clientX, y: e.clientY });
                  setHasDragged(false);
                  handleMouseDown(e);
                }}
                onMouseMove={(e) => {
                  if (dragStartPos && !hasDragged) {
                    const distance = Math.sqrt(
                      Math.pow(e.clientX - dragStartPos.x, 2) +
                        Math.pow(e.clientY - dragStartPos.y, 2)
                    );
                    if (distance > 5) {
                      setHasDragged(true);
                    }
                  }
                }}
                onMouseUp={(e) => {
                  handleMouseUp(e);
                  setDragStartPos(null);
                }}
                onClick={(e) => {
                  if (!hasDragged) {
                    setIsCommandMenuOpen(false);
                    toggleListening({ outputMode: "clipboard" });
                  }
                  e.preventDefault();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!hasDragged) {
                    setWindowInteractivity(true);
                    setIsCommandMenuOpen((prev) => !prev);
                  }
                }}
                onFocus={() => setIsHovered(true)}
                onBlur={() => setIsHovered(false)}
                className={micProps.className}
                style={{
                  ...micProps.style,
                  cursor:
                    isDragging ? "grabbing !important" : "pointer !important",
                  transition:
                    "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s ease-out",
                }}
              >
                <div
                  className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent transition-opacity duration-150"
                  style={{ opacity: micState === "hover" ? 0.8 : 0 }}
                ></div>
                <div
                  className="absolute inset-0 transition-colors duration-150"
                  style={{
                    backgroundColor: micState === "hover" ? "rgba(0,0,0,0.1)" : "transparent",
                  }}
                ></div>

                {micState === "idle" || micState === "hover" ? (
                  <SoundWaveIcon size={micState === "idle" ? 12 : 14} />
                ) : micState === "recording" ? (
                  <LoadingDots />
                ) : micState === "processing" ? (
                  <VoiceWaveIndicator isListening={true} />
                ) : null}

                {micState === "recording" && (
                  <div className="absolute inset-0 rounded-full border-2 border-primary/50 animate-pulse"></div>
                )}

                {micState === "processing" && (
                  <div className="absolute inset-0 rounded-full border-2 border-primary/30 opacity-50"></div>
                )}
              </button>
            </Tooltip>
            {isCommandMenuOpen && (
              <div
                ref={commandMenuRef}
                className="absolute bottom-full right-0 mb-3 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-sm"
                onMouseEnter={() => {
                  setWindowInteractivity(true);
                }}
                onMouseLeave={() => {
                  if (!isHovered) {
                    setWindowInteractivity(false);
                  }
                }}
              >
                <button
                  className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => {
                    toggleListening({ outputMode: "clipboard" });
                  }}
                >
                  {isRecording ? "Stop listening" : "Start listening"}
                </button>
                <div className="h-px bg-border" />
                <button
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => {
                    setIsCommandMenuOpen(false);
                    setWindowInteractivity(false);
                    handleClose();
                  }}
                >
                  Hide this for now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
