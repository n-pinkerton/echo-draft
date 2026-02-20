import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "../../../../hooks/useTheme";
import { SettingsRow } from "../../../ui/SettingsSection";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../../SettingsPanels";

export default function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <SectionHeader title="Appearance" description="Control how EchoDraft looks" />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow label="Theme" description="Choose light, dark, or match your system">
            <div className="inline-flex items-center gap-px p-0.5 bg-muted/60 dark:bg-surface-2 rounded-md">
              {(
                [
                  { value: "light", icon: Sun, label: "Light" },
                  { value: "dark", icon: Moon, label: "Dark" },
                  { value: "auto", icon: Monitor, label: "Auto" },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const isSelected = theme === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setTheme(option.value)}
                    className={`
                              flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-medium
                              transition-all duration-100
                              ${
                                isSelected
                                  ? "bg-background dark:bg-surface-raised text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }
                            `}
                  >
                    <Icon className={`w-3 h-3 ${isSelected ? "text-primary" : ""}`} />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}

