import ApiKeyInput from "../ui/ApiKeyInput";
import { createExternalLinkHandler } from "../../utils/externalLinks";

export function CloudApiKeySection({
  url,
  apiKey,
  setApiKey,
  placeholder,
}: {
  url: string;
  apiKey: string;
  setApiKey: (key: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="font-medium text-foreground">API Key</h4>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={createExternalLinkHandler(url)}
          className="text-xs text-link underline decoration-link/30 hover:decoration-link/60 cursor-pointer transition-colors"
        >
          Get your API key →
        </a>
      </div>
      <ApiKeyInput apiKey={apiKey} setApiKey={setApiKey} placeholder={placeholder} label="" />
    </div>
  );
}

