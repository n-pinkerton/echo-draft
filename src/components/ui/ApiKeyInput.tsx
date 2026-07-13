import React, { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";
import { SAVED_KEY_PLACEHOLDER } from "../../config/apiKeys";
import { Button } from "./button";
import { Input } from "./input";

interface ApiKeyInputProps {
  apiKey: string;
  setApiKey: (key: string) => void | Promise<void>;
  className?: string;
  placeholder?: string;
  label?: string;
  helpText?: React.ReactNode;
  variant?: "default" | "purple";
}

export default function ApiKeyInput({
  apiKey,
  setApiKey,
  className = "",
  placeholder = "sk-...",
  label = "API Key",
  helpText = "Get your API key from platform.openai.com",
  variant = "default",
}: ApiKeyInputProps) {
  const generatedId = useId();
  const inputId = `api-key-${generatedId}`;
  const helpTextId = helpText ? `${inputId}-help` : undefined;
  const statusId = `${inputId}-status`;
  const accessibleLabel = label || "API Key (Optional)";
  const hasSavedKey = apiKey === SAVED_KEY_PLACEHOLDER;
  const [draft, setDraft] = useState(hasSavedKey ? "" : apiKey);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "removing" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const variantClasses = variant === "purple" ? "border-primary focus:border-primary" : "";

  useEffect(() => {
    setDraft(apiKey === SAVED_KEY_PLACEHOLDER ? "" : apiKey);
    setErrorMessage("");
    setState("idle");
  }, [apiKey]);

  const saveDraft = async () => {
    if (state === "saving" || state === "removing") return;
    const normalizedDraft = draft.trim();
    if (!normalizedDraft) {
      setErrorMessage("Enter a key to save, or use Remove saved key.");
      setState("error");
      return;
    }
    setState("saving");
    setErrorMessage("");
    try {
      await setApiKey(normalizedDraft);
      setDraft("");
      setState("saved");
    } catch {
      setErrorMessage("The key could not be saved. Check it and try again.");
      setState("error");
    }
  };

  const removeSavedKey = async () => {
    if (state === "saving" || state === "removing") return;
    setState("removing");
    setErrorMessage("");
    try {
      await setApiKey("");
      setDraft("");
      setState("idle");
    } catch {
      setErrorMessage("The saved key could not be removed. Try again.");
      setState("error");
    }
  };

  const isBusy = state === "saving" || state === "removing";
  const showSaved = hasSavedKey && !draft && state !== "error";

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className={label ? "block text-xs font-medium text-foreground mb-1" : "sr-only"}
      >
        {accessibleLabel}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          type="password"
          aria-describedby={[helpTextId, statusId].filter(Boolean).join(" ")}
          aria-invalid={state === "error" ? "true" : undefined}
          placeholder={hasSavedKey ? "Saved securely — enter a replacement" : placeholder}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setErrorMessage("");
            setState("idle");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveDraft();
            }
          }}
          disabled={isBusy}
          className={`h-8 text-sm ${showSaved ? "pr-8" : ""} ${variantClasses}`}
        />
        {showSaved && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Check aria-hidden="true" className="w-3.5 h-3.5 text-success" />
          </div>
        )}
      </div>
      <div className="mt-1.5 flex min-h-8 items-center gap-2">
        {draft ? (
          <>
            <Button type="button" size="sm" onClick={() => void saveDraft()} disabled={isBusy}>
              {state === "saving" ? "Saving…" : hasSavedKey ? "Replace key" : "Save key"}
            </Button>
            {hasSavedKey ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft("");
                  setErrorMessage("");
                  setState("idle");
                }}
                disabled={isBusy}
              >
                Cancel
              </Button>
            ) : null}
          </>
        ) : hasSavedKey ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void removeSavedKey()}
            disabled={isBusy}
          >
            {state === "removing" ? "Removing…" : "Remove saved key"}
          </Button>
        ) : null}
        <span id={statusId} className="text-[11px] text-muted-foreground" aria-live="polite">
          {showSaved ? "Saved securely" : state === "saved" ? "Saved securely" : ""}
        </span>
      </div>
      {state === "error" ? (
        <p className="mt-1 text-[11px] text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {helpText && (
        <p id={helpTextId} className="text-[11px] text-muted-foreground/70 mt-1">
          {helpText}
        </p>
      )}
    </div>
  );
}
