import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Loader2 } from "lucide-react";
import { Toggle } from "../ui/toggle";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileCleanupEnabled: boolean;
  onCleanupEnabledChange: (next: boolean) => void;
  isFileTranscribing: boolean;
  fileTranscribeStageLabel: string | null;
  fileTranscribeMessage: string | null;
  fileTranscribeFileName: string | null;
  onChooseFile: () => Promise<void>;
};

export default function FileTranscribeDialog({
  open,
  onOpenChange,
  fileCleanupEnabled,
  onCleanupEnabledChange,
  isFileTranscribing,
  fileTranscribeStageLabel,
  fileTranscribeMessage,
  fileTranscribeFileName,
  onChooseFile,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Transcribe audio file</DialogTitle>
          <DialogDescription>
            Uses your current transcription settings (local or cloud). The result is saved to
            history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">Cleanup (AI enhancement)</p>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                Runs the cleanup model after transcription.
              </p>
            </div>
            <div className="shrink-0">
              <Toggle
                checked={fileCleanupEnabled}
                onChange={onCleanupEnabledChange}
                disabled={isFileTranscribing}
              />
            </div>
          </div>

          {isFileTranscribing && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <p className="text-[13px] font-medium text-foreground">
                {fileTranscribeFileName ? `Transcribing ${fileTranscribeFileName}` : "Transcribing…"}
              </p>
              {fileTranscribeStageLabel && (
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                  {fileTranscribeStageLabel}
                  {fileTranscribeMessage ? ` — ${fileTranscribeMessage}` : ""}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isFileTranscribing}>
            Close
          </Button>
          <Button variant="default" onClick={onChooseFile} disabled={isFileTranscribing}>
            {isFileTranscribing ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Working…
              </>
            ) : (
              "Choose file…"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

