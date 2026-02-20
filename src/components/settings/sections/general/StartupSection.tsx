import { useCallback, useEffect, useMemo, useState } from "react";

import { Toggle } from "../../../ui/toggle";
import { SettingsRow } from "../../../ui/SettingsSection";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";
import logger from "../../../../utils/logger";

export default function StartupSection() {
  const platform = useMemo(() => {
    if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
      return window.electronAPI.getPlatform();
    }
    return "linux";
  }, []);

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  useEffect(() => {
    if (platform === "linux") {
      setAutoStartLoading(false);
      return;
    }

    const loadAutoStart = async () => {
      if (window.electronAPI?.getAutoStartEnabled) {
        try {
          const enabled = await window.electronAPI.getAutoStartEnabled();
          setAutoStartEnabled(enabled);
        } catch (error) {
          logger.error("Failed to get auto-start status", error, "settings");
        }
      }
      setAutoStartLoading(false);
    };

    loadAutoStart();
  }, [platform]);

  const handleAutoStartChange = useCallback(async (enabled: boolean) => {
    if (window.electronAPI?.setAutoStartEnabled) {
      try {
        setAutoStartLoading(true);
        const result = await window.electronAPI.setAutoStartEnabled(enabled);
        if (result.success) {
          setAutoStartEnabled(enabled);
        }
      } catch (error) {
        logger.error("Failed to set auto-start", error, "settings");
      } finally {
        setAutoStartLoading(false);
      }
    }
  }, []);

  if (platform === "linux") {
    return null;
  }

  return (
    <div>
      <SectionHeader title="Startup" />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label="Launch at login"
            description="Start EchoDraft automatically when you log in"
          >
            <Toggle
              checked={autoStartEnabled}
              onChange={(checked: boolean) => handleAutoStartChange(checked)}
              disabled={autoStartLoading}
            />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

