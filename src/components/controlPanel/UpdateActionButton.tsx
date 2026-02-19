import { Download, Loader2, RefreshCw } from "lucide-react";

import { Button } from "../ui/button";

type UpdateStatus = {
  isDevelopment?: boolean;
  updateAvailable?: boolean;
  updateDownloaded?: boolean;
};

type Props = {
  updateStatus: UpdateStatus;
  downloadProgress: number;
  isDownloading: boolean;
  isInstalling: boolean;
  onClick: () => void | Promise<void>;
};

export default function UpdateActionButton({
  updateStatus,
  downloadProgress,
  isDownloading,
  isInstalling,
  onClick,
}: Props) {
  if (updateStatus.isDevelopment) {
    return null;
  }

  const shouldShow =
    updateStatus.updateAvailable || updateStatus.updateDownloaded || isDownloading || isInstalling;
  if (!shouldShow) {
    return null;
  }

  const content = (() => {
    if (isInstalling) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>Installing...</span>
        </>
      );
    }
    if (isDownloading) {
      return (
        <>
          <Loader2 size={14} className="animate-spin" />
          <span>{Math.round(downloadProgress)}%</span>
        </>
      );
    }
    if (updateStatus.updateDownloaded) {
      return (
        <>
          <RefreshCw size={14} />
          <span>Install Update</span>
        </>
      );
    }
    if (updateStatus.updateAvailable) {
      return (
        <>
          <Download size={14} />
          <span>Update Available</span>
        </>
      );
    }
    return null;
  })();

  if (!content) {
    return null;
  }

  return (
    <Button
      variant={updateStatus.updateDownloaded ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      disabled={isInstalling || isDownloading}
      className="gap-1.5 text-xs"
    >
      {content}
    </Button>
  );
}

