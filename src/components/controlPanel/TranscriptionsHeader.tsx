import { FileText, Trash2 } from "lucide-react";

import { Button } from "../ui/button";

type Props = {
  historyLength: number;
  filteredHistoryLength: number;
  isFileTranscribing: boolean;
  onOpenFileTranscribeDialog: () => void;
  onClearHistory: () => Promise<void>;
};

export default function TranscriptionsHeader(props: Props) {
  const {
    historyLength,
    filteredHistoryLength,
    isFileTranscribing,
    onOpenFileTranscribeDialog,
    onClearHistory,
  } = props;

  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Transcriptions</h2>
        {historyLength > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            ({filteredHistoryLength}
            {filteredHistoryLength !== historyLength ? ` / ${historyLength}` : ""})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={onOpenFileTranscribeDialog}
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={isFileTranscribing}
        >
          Transcribe Audio File…
        </Button>
        {historyLength > 0 && (
          <Button
            onClick={onClearHistory}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={12} className="mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

