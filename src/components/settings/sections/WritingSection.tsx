import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import type { ConfirmDialogState } from "../../../hooks/useDialogs";
import type { AppStyleProfile, AppWritingStyle, CorrectionRule } from "../../../types/electron";
import {
  MAX_CORRECTION_PHRASE_LENGTH,
  MAX_CORRECTION_REPLACEMENT_LENGTH,
  applyCorrectionRules,
} from "../../../utils/correctionRules.cjs";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../SettingsPanels";

type Props = {
  toast: (options: {
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
    duration?: number;
  }) => void;
  showConfirmDialog: (options: Omit<ConfirmDialogState, "open">) => void;
};

const MAX_PROCESS_NAME_LENGTH = 128;

export default function WritingSection({ toast, showConfirmDialog }: Props) {
  const [rules, setRules] = useState<CorrectionRule[]>([]);
  const [profiles, setProfiles] = useState<AppStyleProfile[]>([]);
  const [sourcePhrase, setSourcePhrase] = useState("");
  const [replacementText, setReplacementText] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [processName, setProcessName] = useState("");
  const [style, setStyle] = useState<AppWritingStyle>("document");
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKind, setSavingKind] = useState<"rule" | "profile" | null>(null);

  const reload = async () => {
    const [nextRules, nextProfiles] = await Promise.all([
      window.electronAPI.getCorrectionRules(),
      window.electronAPI.getAppStyleProfiles(),
    ]);
    setRules(nextRules);
    setProfiles(nextProfiles);
  };

  useEffect(() => {
    let active = true;
    Promise.all([window.electronAPI.getCorrectionRules(), window.electronAPI.getAppStyleProfiles()])
      .then(([nextRules, nextProfiles]) => {
        if (!active) return;
        setRules(nextRules);
        setProfiles(nextProfiles);
      })
      .catch(() => {
        if (active) {
          toast({
            title: "Writing settings unavailable",
            description: "Could not load local corrections and application styles.",
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const preview = useMemo(() => {
    if (!previewText || !sourcePhrase.trim() || !replacementText.trim()) return previewText;
    return applyCorrectionRules(previewText, [
      { id: editingRuleId || 1, sourcePhrase, replacementText, enabled: true },
    ]).text;
  }, [editingRuleId, previewText, replacementText, sourcePhrase]);

  const clearRuleForm = () => {
    setEditingRuleId(null);
    setSourcePhrase("");
    setReplacementText("");
  };

  const saveRule = async () => {
    if (!sourcePhrase.trim() || !replacementText.trim() || savingKind) return;
    setSavingKind("rule");
    try {
      await window.electronAPI.saveCorrectionRule({
        ...(editingRuleId ? { id: editingRuleId } : {}),
        sourcePhrase,
        replacementText,
        enabled: editingRuleId
          ? rules.find((rule) => rule.id === editingRuleId)?.enabled !== false
          : true,
      });
      await reload();
      clearRuleForm();
    } catch (error) {
      toast({
        title: "Could not save correction",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingKind(null);
    }
  };

  const updateRuleEnabled = async (rule: CorrectionRule, enabled: boolean) => {
    try {
      await window.electronAPI.saveCorrectionRule({ ...rule, enabled });
      await reload();
    } catch (error) {
      toast({
        title: "Could not update correction",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const deleteRule = async (rule: CorrectionRule) => {
    try {
      await window.electronAPI.deleteCorrectionRule(rule.id);
      await reload();
    } catch (error) {
      toast({
        title: "Could not delete correction",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const confirmDeleteRule = (rule: CorrectionRule) => {
    showConfirmDialog({
      title: "Delete This Correction?",
      description: `EchoDraft will stop replacing “${rule.sourcePhrase}” with “${rule.replacementText}”.`,
      confirmText: "Delete Correction",
      variant: "destructive",
      onConfirm: () => void deleteRule(rule),
    });
  };

  const clearProfileForm = () => {
    setEditingProfileId(null);
    setProcessName("");
    setStyle("document");
  };

  const saveProfile = async () => {
    if (!processName.trim() || savingKind) return;
    setSavingKind("profile");
    try {
      await window.electronAPI.saveAppStyleProfile({
        ...(editingProfileId ? { id: editingProfileId } : {}),
        processName,
        style,
        enabled: editingProfileId
          ? profiles.find((profile) => profile.id === editingProfileId)?.enabled !== false
          : true,
      });
      await reload();
      clearProfileForm();
    } catch (error) {
      toast({
        title: "Could not save application style",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingKind(null);
    }
  };

  const updateProfileEnabled = async (profile: AppStyleProfile, enabled: boolean) => {
    try {
      await window.electronAPI.saveAppStyleProfile({ ...profile, enabled });
      await reload();
    } catch (error) {
      toast({
        title: "Could not update application style",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const deleteProfile = async (profile: AppStyleProfile) => {
    try {
      await window.electronAPI.deleteAppStyleProfile(profile.id);
      await reload();
    } catch (error) {
      toast({
        title: "Could not delete application style",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const confirmDeleteProfile = (profile: AppStyleProfile) => {
    showConfirmDialog({
      title: "Delete This Application Style?",
      description: `EchoDraft will stop applying the ${profile.style} style to ${profile.processName}.`,
      confirmText: "Delete Mapping",
      variant: "destructive",
      onConfirm: () => void deleteProfile(profile),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading writing settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">Writing</h3>
        <p className="text-sm text-muted-foreground">
          Apply explicit local replacements before cleanup, and choose one fixed style by
          application process name.
        </p>
      </div>

      <section aria-labelledby="correction-rules-heading">
        <SectionHeader
          headingId="correction-rules-heading"
          title="Always replace this"
          description="Exact, boundary-aware rules are stored locally and remain separate from the speech dictionary. EchoDraft never learns rules automatically."
        />
        <SettingsPanel>
          <SettingsPanelRow className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Heard phrase
                <Input
                  aria-label="Correction source phrase"
                  name="correction-source-phrase"
                  autoComplete="off"
                  value={sourcePhrase}
                  onChange={(event) => setSourcePhrase(event.target.value)}
                  maxLength={MAX_CORRECTION_PHRASE_LENGTH}
                  placeholder="eco draft"
                />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Written form
                <Input
                  aria-label="Correction replacement text"
                  name="correction-replacement-text"
                  autoComplete="off"
                  value={replacementText}
                  onChange={(event) => setReplacementText(event.target.value)}
                  maxLength={MAX_CORRECTION_REPLACEMENT_LENGTH}
                  placeholder="EchoDraft"
                />
              </label>
            </div>
            <label className="block space-y-1 text-[11px] text-muted-foreground">
              Preview text
              <Input
                aria-label="Correction preview text"
                name="correction-preview-text"
                autoComplete="off"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                placeholder="Try the phrase in a sentence"
              />
            </label>
            {previewText ? (
              <div
                className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs"
                aria-live="polite"
              >
                <span className="font-medium text-muted-foreground">Preview: </span>
                <span className="text-foreground">{preview}</span>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void saveRule()}
                disabled={!sourcePhrase.trim() || !replacementText.trim() || savingKind !== null}
              >
                {savingKind === "rule" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {savingKind === "rule"
                  ? "Saving…"
                  : editingRuleId
                    ? "Save correction"
                    : "Add correction"}
              </Button>
              {editingRuleId ? (
                <Button size="sm" variant="ghost" onClick={clearRuleForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </SettingsPanelRow>
          {rules.map((rule) => (
            <SettingsPanelRow key={rule.id} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => void updateRuleEnabled(rule, event.target.checked)}
                  aria-label={`Enable correction ${rule.sourcePhrase}`}
                  name={`correction-rule-${rule.id}-enabled`}
                />
                <span className="break-words text-foreground" translate="no">
                  {rule.sourcePhrase} → {rule.replacementText}
                </span>
              </label>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit correction ${rule.sourcePhrase}`}
                onClick={() => {
                  setEditingRuleId(rule.id);
                  setSourcePhrase(rule.sourcePhrase);
                  setReplacementText(rule.replacementText);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete correction ${rule.sourcePhrase}`}
                onClick={() => confirmDeleteRule(rule)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </SettingsPanelRow>
          ))}
        </SettingsPanel>
      </section>

      <section aria-labelledby="application-styles-heading">
        <SectionHeader
          headingId="application-styles-heading"
          title="Application styles"
          description="Map a process name to Document, Message, or Technical. EchoDraft does not capture or send window titles, selected text, clipboard contents, or surrounding content. Prompt hotkeys ignore these styles."
        />
        <SettingsPanel>
          <SettingsPanelRow className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Process name
                <Input
                  aria-label="Application process name"
                  name="application-process-name"
                  autoComplete="off"
                  spellCheck={false}
                  value={processName}
                  onChange={(event) => setProcessName(event.target.value)}
                  maxLength={MAX_PROCESS_NAME_LENGTH}
                  placeholder="winword"
                />
              </label>
              <label className="space-y-1 text-[11px] text-muted-foreground">
                Fixed style
                <select
                  aria-label="Application writing style"
                  name="application-writing-style"
                  value={style}
                  onChange={(event) => setStyle(event.target.value as AppWritingStyle)}
                  className="h-10 w-full rounded border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="document">Document</option>
                  <option value="message">Message</option>
                  <option value="technical">Technical</option>
                </select>
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void saveProfile()}
                disabled={!processName.trim() || savingKind !== null}
              >
                {savingKind === "profile" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {savingKind === "profile"
                  ? "Saving…"
                  : editingProfileId
                    ? "Save mapping"
                    : "Add mapping"}
              </Button>
              {editingProfileId ? (
                <Button size="sm" variant="ghost" onClick={clearProfileForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </SettingsPanelRow>
          {profiles.map((profile) => (
            <SettingsPanelRow key={profile.id} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={profile.enabled}
                  onChange={(event) => void updateProfileEnabled(profile, event.target.checked)}
                  aria-label={`Enable application style ${profile.processName}`}
                  name={`application-style-${profile.id}-enabled`}
                />
                <span className="break-words text-foreground" translate="no">
                  {profile.processName} → {profile.style[0].toUpperCase() + profile.style.slice(1)}
                </span>
              </label>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit application style ${profile.processName}`}
                onClick={() => {
                  setEditingProfileId(profile.id);
                  setProcessName(profile.processName);
                  setStyle(profile.style);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete application style ${profile.processName}`}
                onClick={() => confirmDeleteProfile(profile)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </SettingsPanelRow>
          ))}
        </SettingsPanel>
      </section>
    </div>
  );
}
