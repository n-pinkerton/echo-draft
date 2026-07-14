import { useCallback, useEffect, useRef, useState } from "react";

import { getPlatform } from "../../../utils/platform";
import { mapKeyboardEventToHotkey } from "./keyboardEventToHotkey";
import {
  buildModifierOnlyHotkey,
  type HeldModifiers,
  type ModifierCodes,
} from "./modifierOnlyHotkey";

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
]);

const MODIFIER_HOLD_THRESHOLD_MS = 200;
const HOTKEY_UPDATE_SETTLE_TIMEOUT_MS = 3000;

export interface UseHotkeyCaptureParams {
  disabled: boolean;
  autoFocus: boolean;
  validate?: (hotkey: string) => string | null | undefined;
  captureTarget: "insert" | "clipboard";
  onChange: (hotkey: string) => void | Promise<void>;
  onBlur?: () => void;
}

export function useHotkeyCapture({
  disabled,
  autoFocus,
  validate,
  captureTarget,
  onChange,
  onBlur,
}: UseHotkeyCaptureParams) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [activeModifiers, setActiveModifiers] = useState<Set<string>>(new Set());
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [isFnHeld, setIsFnHeld] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastCapturedHotkeyRef = useRef<string | null>(null);
  const keyDownTimeRef = useRef<number>(0);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnHeldRef = useRef(false);
  const fnCapturedKeyRef = useRef(false);
  const isFinalizingRef = useRef(false);
  const captureReleasedRef = useRef(true);
  const heldModifiersRef = useRef<HeldModifiers>({
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  });
  const modifierCodesRef = useRef<ModifierCodes>({});

  const platform = getPlatform();
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";

  const clearFnHeld = useCallback(() => {
    setIsFnHeld(false);
    fnHeldRef.current = false;
    fnCapturedKeyRef.current = false;
  }, []);

  const releaseCapture = useCallback(() => {
    if (captureReleasedRef.current) return;
    captureReleasedRef.current = true;
    setIsCapturing(false);
    setActiveModifiers(new Set());
    setValidationWarning(null);
    clearFnHeld();
    window.electronAPI?.setHotkeyListeningMode?.(
      false,
      lastCapturedHotkeyRef.current,
      captureTarget
    );
    lastCapturedHotkeyRef.current = null;
    onBlur?.();
  }, [captureTarget, onBlur, clearFnHeld]);

  const finalizeCapture = useCallback(
    async (hotkey: string) => {
      if (isFinalizingRef.current) return;
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = null;
      }

      if (validate) {
        const errorMsg = validate(hotkey);
        if (errorMsg) {
          setValidationWarning(errorMsg);
          warningTimeoutRef.current = setTimeout(() => setValidationWarning(null), 4000);
          heldModifiersRef.current = { ctrl: false, meta: false, alt: false, shift: false };
          modifierCodesRef.current = {};
          setActiveModifiers(new Set());
          keyDownTimeRef.current = 0;
          clearFnHeld();
          return;
        }
      }

      isFinalizingRef.current = true;
      setValidationWarning(null);
      lastCapturedHotkeyRef.current = hotkey;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        // Persist/register first so the main process can recover the accepted shortcut on blur.
        // Calling blur immediately used to race the update IPC and restart a stale native route.
        let update: Promise<void>;
        try {
          update = Promise.resolve(onChange(hotkey));
        } catch (error) {
          update = Promise.reject(error);
        }
        const settledUpdate = update.catch(() => undefined);
        await Promise.race([
          settledUpdate,
          new Promise<void>((resolve) => {
            // A lost renderer/main-process reply must not leave all dictation shortcuts disabled.
            // The update promise keeps its rejection handler if it settles after this deadline.
            settleTimer = setTimeout(resolve, HOTKEY_UPDATE_SETTLE_TIMEOUT_MS);
          }),
        ]);
      } catch {
        // Registration failures are presented by the owning settings flow; blur still has to
        // release capture mode so the previously accepted shortcut can be recovered.
      } finally {
        if (settleTimer) clearTimeout(settleTimer);
        isFinalizingRef.current = false;
        releaseCapture();
        containerRef.current?.blur();
      }
    },
    [validate, onChange, clearFnHeld, releaseCapture]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      heldModifiersRef.current = {
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
      };

      const code = e.nativeEvent.code;
      if (code === "ControlLeft" || code === "ControlRight") {
        modifierCodesRef.current.ctrl = code;
      } else if (code === "MetaLeft" || code === "MetaRight") {
        modifierCodesRef.current.meta = code;
      } else if (code === "AltLeft" || code === "AltRight") {
        modifierCodesRef.current.alt = code;
      } else if (code === "ShiftLeft" || code === "ShiftRight") {
        modifierCodesRef.current.shift = code;
      }

      if (keyDownTimeRef.current === 0) {
        keyDownTimeRef.current = Date.now();
      }

      const mods = new Set<string>();
      if (isMac) {
        if (e.metaKey) mods.add("Cmd");
        if (e.ctrlKey) mods.add("Ctrl");
      } else {
        if (e.ctrlKey) mods.add("Ctrl");
        if (e.metaKey) mods.add(isWindows ? "Win" : "Super");
      }
      if (e.altKey) mods.add(isMac ? "Option" : "Alt");
      if (e.shiftKey) mods.add("Shift");
      if (fnHeldRef.current) mods.add("Fn");
      setActiveModifiers(mods);

      const hotkey = mapKeyboardEventToHotkey(e.nativeEvent, platform);
      if (hotkey) {
        keyDownTimeRef.current = 0;
        if (fnHeldRef.current) {
          fnCapturedKeyRef.current = true;
          void finalizeCapture(`Fn+${hotkey}`);
        } else {
          void finalizeCapture(hotkey);
        }
      }
    },
    [disabled, isMac, isWindows, platform, finalizeCapture]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.preventDefault();

      const wasHoldingModifiers =
        heldModifiersRef.current.ctrl ||
        heldModifiersRef.current.meta ||
        heldModifiersRef.current.alt ||
        heldModifiersRef.current.shift;

      let attempted = false;

      if (wasHoldingModifiers && MODIFIER_CODES.has(e.nativeEvent.code)) {
        const holdDuration = Date.now() - keyDownTimeRef.current;

        if (holdDuration >= MODIFIER_HOLD_THRESHOLD_MS) {
          const modifierHotkey = buildModifierOnlyHotkey(
            heldModifiersRef.current,
            modifierCodesRef.current,
            { isMac }
          );
          if (modifierHotkey) {
            attempted = true;
            if (fnHeldRef.current) {
              fnCapturedKeyRef.current = true;
              void finalizeCapture(`Fn+${modifierHotkey}`);
            } else {
              void finalizeCapture(modifierHotkey);
            }
          }
        }
      }

      if (!attempted) {
        heldModifiersRef.current = { ctrl: false, meta: false, alt: false, shift: false };
        modifierCodesRef.current = {};
        setActiveModifiers(fnHeldRef.current ? new Set(["Fn"]) : new Set());
        keyDownTimeRef.current = 0;
      }
    },
    [disabled, isMac, finalizeCapture]
  );

  const handleFocus = useCallback(() => {
    if (disabled) {
      return;
    }
    setIsCapturing(true);
    captureReleasedRef.current = false;
    setValidationWarning(null);
    clearFnHeld();
    window.electronAPI?.setHotkeyListeningMode?.(true, null, captureTarget);
  }, [captureTarget, disabled, clearFnHeld]);

  const handleBlur = useCallback(() => {
    if (isFinalizingRef.current) return;
    releaseCapture();
  }, [releaseCapture]);

  useEffect(() => {
    if (autoFocus && containerRef.current) {
      containerRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      window.electronAPI?.setHotkeyListeningMode?.(false, null, captureTarget);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    };
  }, [captureTarget]);

  useEffect(() => {
    if (!isCapturing || !isMac) return;

    const disposeDown = window.electronAPI?.onGlobeKeyPressed?.(() => {
      setValidationWarning(null);
      setIsFnHeld(true);
      fnHeldRef.current = true;
      fnCapturedKeyRef.current = false;
      setActiveModifiers((prev) => new Set([...prev, "Fn"]));
    });

    const disposeUp = window.electronAPI?.onGlobeKeyReleased?.(() => {
      if (fnHeldRef.current && !fnCapturedKeyRef.current) {
        void finalizeCapture("GLOBE");
      }
      setIsFnHeld(false);
      fnHeldRef.current = false;
      fnCapturedKeyRef.current = false;
    });

    return () => {
      disposeDown?.();
      disposeUp?.();
    };
  }, [isCapturing, isMac, finalizeCapture]);

  return {
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
  };
}
