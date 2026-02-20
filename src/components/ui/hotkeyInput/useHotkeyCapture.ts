import { useCallback, useEffect, useRef, useState } from "react";

import { getPlatform } from "../../../utils/platform";
import { mapKeyboardEventToHotkey } from "./keyboardEventToHotkey";
import { buildModifierOnlyHotkey, type HeldModifiers, type ModifierCodes } from "./modifierOnlyHotkey";

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

export interface UseHotkeyCaptureParams {
  disabled: boolean;
  autoFocus: boolean;
  validate?: (hotkey: string) => string | null | undefined;
  captureTarget: "insert" | "clipboard";
  onChange: (hotkey: string) => void;
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
  const heldModifiersRef = useRef<HeldModifiers>({ ctrl: false, meta: false, alt: false, shift: false });
  const modifierCodesRef = useRef<ModifierCodes>({});

  const platform = getPlatform();
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";

  const clearFnHeld = useCallback(() => {
    setIsFnHeld(false);
    fnHeldRef.current = false;
    fnCapturedKeyRef.current = false;
  }, []);

  const finalizeCapture = useCallback(
    (hotkey: string) => {
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

      setValidationWarning(null);
      lastCapturedHotkeyRef.current = hotkey;
      onChange(hotkey);
      setIsCapturing(false);
      setActiveModifiers(new Set());
      clearFnHeld();
      containerRef.current?.blur();
    },
    [validate, onChange, clearFnHeld]
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
          finalizeCapture(`Fn+${hotkey}`);
        } else {
          finalizeCapture(hotkey);
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
          const modifierHotkey = buildModifierOnlyHotkey(heldModifiersRef.current, modifierCodesRef.current, { isMac });
          if (modifierHotkey) {
            attempted = true;
            if (fnHeldRef.current) {
              fnCapturedKeyRef.current = true;
              finalizeCapture(`Fn+${modifierHotkey}`);
            } else {
              finalizeCapture(modifierHotkey);
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
    setValidationWarning(null);
    clearFnHeld();
    window.electronAPI?.setHotkeyListeningMode?.(true, null, captureTarget);
  }, [captureTarget, disabled, clearFnHeld]);

  const handleBlur = useCallback(() => {
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
        finalizeCapture("GLOBE");
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

