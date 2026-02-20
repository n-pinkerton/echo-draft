export const CLOUD_PROVIDER_TABS = [
  { id: "openai", name: "OpenAI" },
  { id: "groq", name: "Groq", recommended: true },
  { id: "mistral", name: "Mistral" },
  { id: "custom", name: "Custom" },
] as const;

export const VALID_CLOUD_PROVIDER_IDS = CLOUD_PROVIDER_TABS.map((provider) => provider.id);

export const LOCAL_PROVIDER_TABS: Array<{ id: string; name: string; disabled?: boolean }> = [
  { id: "whisper", name: "OpenAI Whisper" },
  { id: "nvidia", name: "NVIDIA Parakeet" },
];

