import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeAudioInputDevices, type SelectableAudioInput } from "../utils/audioDeviceUtils";

export function useAudioInputDevices() {
  const [devices, setDevices] = useState<SelectableAudioInput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasHiddenLabels, setHasHiddenLabels] = useState(false);
  const mountedRef = useRef(false);
  const latestRequestRef = useRef(0);

  const loadDevices = useCallback(async (requestPermission = false) => {
    if (!mountedRef.current) return;
    const mediaDevices = navigator.mediaDevices;
    const requestId = ++latestRequestRef.current;

    if (!mediaDevices?.enumerateDevices) {
      if (mountedRef.current) setError("Microphone list unavailable.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (requestPermission) {
        const stream = await mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }

      const allDevices = await mediaDevices.enumerateDevices();
      if (!mountedRef.current || requestId !== latestRequestRef.current) return;

      const audioInputs = allDevices.filter((device) => device.kind === "audioinput");
      setDevices(normalizeAudioInputDevices(audioInputs));
      setHasHiddenLabels(audioInputs.some((device) => !device.label));
      setHasLoaded(true);
    } catch {
      if (!mountedRef.current || requestId !== latestRequestRef.current) return;
      setError("Unable to list microphones. Check Windows microphone permissions.");
    } finally {
      if (mountedRef.current && requestId === latestRequestRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDevices();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return () => {
        mountedRef.current = false;
        latestRequestRef.current += 1;
      };
    }

    const handleDeviceChange = () => void loadDevices();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mountedRef.current = false;
      latestRequestRef.current += 1;
      mediaDevices.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [loadDevices]);

  return {
    devices,
    isLoading,
    error,
    hasLoaded,
    hasHiddenLabels,
    refreshDevices: () => loadDevices(false),
    requestDeviceLabels: () => loadDevices(true),
  };
}
