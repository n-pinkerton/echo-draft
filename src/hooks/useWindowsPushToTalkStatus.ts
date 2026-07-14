import { useCallback, useEffect, useRef } from "react";

import {
  getWindowsPushToTalkRecoveredNotice,
  getWindowsPushToTalkUnavailableNotice,
  type WindowsPushToTalkRecoveredPayload,
  type WindowsPushToTalkUnavailablePayload,
} from "../utils/windowsPushToTalkNotice";

type Toast = (options: {
  title: string;
  description: string;
  duration: number;
  variant: "default" | "success";
}) => string | void;

interface Options {
  toast: Toast;
  dismiss?: (id?: string) => void;
  updateTray?: boolean;
}

export function useWindowsPushToTalkStatus({ toast, dismiss, updateTray = false }: Options) {
  const activeNoticeIdRef = useRef<string | null>(null);

  const replaceNotice = useCallback(
    (
      notice:
        | ReturnType<typeof getWindowsPushToTalkUnavailableNotice>
        | ReturnType<typeof getWindowsPushToTalkRecoveredNotice>
    ) => {
      if (activeNoticeIdRef.current) dismiss?.(activeNoticeIdRef.current);
      activeNoticeIdRef.current = null;
      if (updateTray) window.electronAPI?.updateTrayStatus?.(notice.tray);
      const id = toast({
        title: notice.title,
        description: notice.description,
        duration: notice.duration,
        variant: notice.variant,
      });
      if (notice.remainsUnavailable && typeof id === "string") activeNoticeIdRef.current = id;
    },
    [dismiss, toast, updateTray]
  );

  useEffect(() => {
    const disposeUnavailable = window.electronAPI?.onWindowsPushToTalkUnavailable?.(
      (payload: WindowsPushToTalkUnavailablePayload) => {
        replaceNotice(getWindowsPushToTalkUnavailableNotice(payload));
      }
    );
    const disposeRecovered = window.electronAPI?.onWindowsPushToTalkRecovered?.(
      (payload: WindowsPushToTalkRecoveredPayload) => {
        replaceNotice(getWindowsPushToTalkRecoveredNotice(payload));
      }
    );

    return () => {
      disposeUnavailable?.();
      disposeRecovered?.();
    };
  }, [replaceNotice]);
}
