import { useEffect, useRef } from "react";
import { getDefaultHotkey } from "../../utils/hotkeys";

type AutoRegisterDefaultHotkeyParams = {
  currentStep: number;
  activationStepIndex: number;
  hotkey: string;
  registerHotkey: (hotkey: string) => Promise<boolean>;
  setHotkey: (hotkey: string) => void;
};

export const shouldAutoRegisterHotkey = ({
  hotkey,
  platform,
}: {
  hotkey: string;
  platform: string;
}): boolean => {
  return !hotkey || hotkey.trim() === "" || (platform !== "darwin" && hotkey === "GLOBE");
};

export const useAutoRegisterDefaultHotkey = ({
  currentStep,
  activationStepIndex,
  hotkey,
  registerHotkey,
  setHotkey,
}: AutoRegisterDefaultHotkeyParams) => {
  const autoRegisterInFlightRef = useRef(false);
  const hotkeyStepInitializedRef = useRef(false);

  useEffect(() => {
    if (currentStep !== activationStepIndex) {
      hotkeyStepInitializedRef.current = false;
      return;
    }

    if (autoRegisterInFlightRef.current || hotkeyStepInitializedRef.current) {
      return;
    }

    const autoRegisterDefaultHotkey = async () => {
      autoRegisterInFlightRef.current = true;
      hotkeyStepInitializedRef.current = true;

      try {
        const defaultHotkey = getDefaultHotkey();
        const platform = window.electronAPI?.getPlatform?.() ?? "darwin";

        if (!shouldAutoRegisterHotkey({ hotkey, platform })) {
          return;
        }

        const success = await registerHotkey(defaultHotkey);
        if (success) {
          setHotkey(defaultHotkey);
        }
      } catch (error) {
        console.error("Failed to auto-register default hotkey:", error);
      } finally {
        autoRegisterInFlightRef.current = false;
      }
    };

    void autoRegisterDefaultHotkey();
  }, [activationStepIndex, currentStep, hotkey, registerHotkey, setHotkey]);
};

