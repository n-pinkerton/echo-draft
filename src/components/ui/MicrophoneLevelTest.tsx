import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Mic, Square } from "lucide-react";

import { Button } from "./button";

const TEST_DURATION_MS = 15_000;

type TestState = "idle" | "requesting" | "active" | "complete" | "disconnected" | "error";

interface MicrophoneLevelTestProps {
  deviceId?: string;
  deviceLabel: string;
  fallbackMessage?: string | null;
}

const getSignalLabel = (level: number) => {
  if (level >= 0.7) return "Loud signal";
  if (level >= 0.2) return "Good signal";
  if (level >= 0.04) return "Quiet signal";
  return "No signal yet—speak into the microphone";
};

export default function MicrophoneLevelTest({
  deviceId,
  deviceLabel,
  fallbackMessage = null,
}: MicrophoneLevelTestProps) {
  const [testState, setTestState] = useState<TestState>("idle");
  const [level, setLevel] = useState(0);
  const [resultLevel, setResultLevel] = useState(0);
  const [activeLabel, setActiveLabel] = useState(deviceLabel);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef(0);
  const peakLevelRef = useRef(0);

  const releaseResources = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
    } catch {
      // A disconnected graph is already safe to release.
    }
    sourceRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
  }, []);

  const stopTest = useCallback(
    (nextState: TestState = "complete") => {
      if (nextState === "complete") {
        setResultLevel(peakLevelRef.current);
      }
      sessionRef.current += 1;
      releaseResources();
      setTestState(nextState);
    },
    [releaseResources]
  );

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      releaseResources();
    };
  }, [releaseResources]);

  useEffect(() => {
    if (testState === "active" || testState === "requesting") {
      stopTest("idle");
    }
    setLevel(0);
    setResultLevel(0);
    peakLevelRef.current = 0;
    setActiveLabel(deviceLabel);
    setError(null);
    // A device-selection change invalidates an active test.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, deviceLabel]);

  const startTest = useCallback(async () => {
    stopTest("requesting");
    const sessionId = ++sessionRef.current;
    setError(null);
    setLevel(0);
    setResultLevel(0);
    peakLevelRef.current = 0;
    setTestState("requesting");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone testing is unavailable in this environment.");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      if (sessionId !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      if (!track) {
        releaseResources();
        throw new Error("No audio track was returned by the selected microphone.");
      }

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        releaseResources();
        throw new Error("Live microphone level testing is unavailable.");
      }

      const context: AudioContext = new AudioContextCtor();
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = context.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      setActiveLabel(track.label || deviceLabel);
      setTestState("active");

      const handleEnded = () => {
        if (sessionId !== sessionRef.current) return;
        setError("The microphone disconnected during the test.");
        stopTest("disconnected");
      };
      track.addEventListener?.("ended", handleEnded, { once: true });

      const samples = new Float32Array(analyser.fftSize);
      const readLevel = () => {
        if (sessionId !== sessionRef.current || !analyserRef.current) return;
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) {
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        const nextLevel = Math.min(1, rms * 4.5);
        peakLevelRef.current = Math.max(peakLevelRef.current, nextLevel);
        setLevel(nextLevel);
        frameRef.current = requestAnimationFrame(readLevel);
      };
      frameRef.current = requestAnimationFrame(readLevel);
      timeoutRef.current = setTimeout(() => stopTest("complete"), TEST_DURATION_MS);
    } catch (caughtError) {
      if (sessionId !== sessionRef.current) return;
      releaseResources();
      const name = caughtError instanceof DOMException ? caughtError.name : "";
      const message =
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow access in Windows privacy settings and try again."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "The selected microphone is unavailable. Reconnect it or choose System Default."
            : caughtError instanceof Error
              ? caughtError.message
              : "The microphone test could not start.";
      setError(message);
      setTestState("error");
    }
  }, [deviceId, deviceLabel, releaseResources, stopTest]);

  const isRunning = testState === "active" || testState === "requesting";
  const displayedLevel = testState === "complete" ? resultLevel : level;
  const signalLabel = getSignalLabel(displayedLevel);

  return (
    <div
      data-testid="microphone-level-test"
      className="rounded-lg border border-border/70 bg-muted/20 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Test microphone</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Starts only when you click Test and stops automatically after 15 seconds.
          </p>
        </div>
        {isRunning ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Stop microphone test"
            onClick={() => stopTest("complete")}
          >
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Start microphone test"
            onClick={() => void startTest()}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            Test
          </Button>
        )}
      </div>

      {fallbackMessage ? (
        <p className="mt-2 text-xs text-warning-text" role="status">
          {fallbackMessage}
        </p>
      ) : null}

      {testState === "requesting" ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Requesting microphone access…
        </p>
      ) : null}

      {testState === "active" || testState === "complete" ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">{activeLabel}</span>
            <span
              className="shrink-0 font-medium text-foreground"
              role={testState === "complete" ? "status" : undefined}
            >
              {testState === "complete" ? `Last result: ${signalLabel}` : signalLabel}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Live microphone input level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(displayedLevel * 100)}
            className="h-2 overflow-hidden rounded-full bg-border/70"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-100 ${
                displayedLevel >= 0.7
                  ? "bg-warning"
                  : displayedLevel >= 0.04
                    ? "bg-success"
                    : "bg-muted-foreground/40"
              }`}
              style={{ width: `${Math.max(2, Math.round(displayedLevel * 100))}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs leading-relaxed text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
