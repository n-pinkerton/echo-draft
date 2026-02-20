import { useEffect, useState } from "react";

export const useGnomeHotkeyMode = (
  setActivationMode: (mode: "tap" | "push") => void
): boolean => {
  const [isUsingGnomeHotkeys, setIsUsingGnomeHotkeys] = useState(false);

  useEffect(() => {
    let isActive = true;

    const checkHotkeyMode = async () => {
      if (!window.electronAPI?.getHotkeyModeInfo) {
        return;
      }

      try {
        const info = await window.electronAPI.getHotkeyModeInfo();
        if (isActive && info?.isUsingGnome) {
          setIsUsingGnomeHotkeys(true);
          setActivationMode("tap");
        }
      } catch (error) {
        console.error("Failed to check hotkey mode:", error);
      }
    };

    void checkHotkeyMode();

    return () => {
      isActive = false;
    };
  }, [setActivationMode]);

  return isUsingGnomeHotkeys;
};

