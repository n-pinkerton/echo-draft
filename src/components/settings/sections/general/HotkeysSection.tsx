import { useCallback, useEffect, useState } from "react";

import { HotkeyInput } from "../../../ui/HotkeyInput";
import { ActivationModeSelector } from "../../../ui/ActivationModeSelector";
import { useHotkeyRegistration } from "../../../../hooks/useHotkeyRegistration";
import { useSettings } from "../../../../hooks/useSettings";
import { getValidationMessage } from "../../../../utils/hotkeyValidator";
import { getPlatform } from "../../../../utils/platform";
import type { AlertDialogState } from "../../../../hooks/useDialogs";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";
import logger from "../../../../utils/logger";

type Props = {
  showAlertDialog: (options: Omit<AlertDialogState, "open">) => void;
};

export default function HotkeysSection(props: Props) {
  const { showAlertDialog } = props;
  const {
    dictationKey,
    dictationKeyClipboard,
    activationMode,
    setActivationMode,
    setDictationKey,
    setDictationKeyClipboard,
  } = useSettings();
  const [isUsingGnomeHotkeys, setIsUsingGnomeHotkeys] = useState(false);

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  const { registerHotkey: registerClipboardHotkey, isRegistering: isClipboardHotkeyRegistering } =
    useHotkeyRegistration({
      onSuccess: (registeredHotkey) => {
        setDictationKeyClipboard(registeredHotkey);
      },
      registerHandler: async (hotkey: string) => {
        if (!window.electronAPI?.updateClipboardHotkey) {
          return { success: true, message: "Clipboard hotkey updated." };
        }
        return window.electronAPI.updateClipboardHotkey(hotkey);
      },
      showSuccessToast: false,
      showErrorToast: true,
      showAlert: showAlertDialog,
    });

  const validateInsertHotkeyForInput = useCallback(
    (hotkey: string) => {
      const validationMessage = getValidationMessage(hotkey, getPlatform());
      if (validationMessage) {
        return validationMessage;
      }
      if (hotkey === dictationKeyClipboard) {
        return "Insert and Clipboard hotkeys must be different.";
      }
      return null;
    },
    [dictationKeyClipboard]
  );

  const validateClipboardHotkeyForInput = useCallback(
    (hotkey: string) => {
      const validationMessage = getValidationMessage(hotkey, getPlatform());
      if (validationMessage) {
        return validationMessage;
      }
      if (hotkey === "GLOBE") {
        return "Globe is reserved for the primary dictation hotkey.";
      }
      if (hotkey === dictationKey) {
        return "Insert and Clipboard hotkeys must be different.";
      }
      return null;
    },
    [dictationKey]
  );

  useEffect(() => {
    const checkHotkeyMode = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo();
        if (info?.isUsingGnome) {
          setIsUsingGnomeHotkeys(true);
          setActivationMode("tap");
        }
      } catch (error) {
        logger.error("Failed to check hotkey mode", error, "settings");
      }
    };
    checkHotkeyMode();
  }, [setActivationMode]);

  return (
    <div>
      <SectionHeader
        title="Dictation Hotkey"
        description="The key combination that starts and stops voice dictation"
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <p className="text-[11px] font-medium text-muted-foreground/80 mb-2">
            Insert mode hotkey
          </p>
          <HotkeyInput
            value={dictationKey}
            onChange={async (newHotkey) => {
              await registerHotkey(newHotkey);
            }}
            disabled={isHotkeyRegistering}
            validate={validateInsertHotkeyForInput}
            captureTarget="insert"
          />
        </SettingsPanelRow>

        <SettingsPanelRow>
          <p className="text-[11px] font-medium text-muted-foreground/80 mb-2">
            Clipboard mode hotkey
          </p>
          <HotkeyInput
            value={dictationKeyClipboard}
            onChange={async (newHotkey) => {
              await registerClipboardHotkey(newHotkey);
            }}
            disabled={isClipboardHotkeyRegistering}
            validate={validateClipboardHotkeyForInput}
            captureTarget="clipboard"
          />
        </SettingsPanelRow>

        {!isUsingGnomeHotkeys && (
          <SettingsPanelRow>
            <p className="text-[11px] font-medium text-muted-foreground/80 mb-2">
              Activation Mode
            </p>
            <ActivationModeSelector value={activationMode} onChange={setActivationMode} />
          </SettingsPanelRow>
        )}
      </SettingsPanel>
    </div>
  );
}

