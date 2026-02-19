import logger from "../../utils/logger";

export const createStartRecordingHandler = (deps) => {
  const {
    activeSessionRef,
    audioManagerRef,
    normalizeTriggerPayload,
    recordingSessionIdRef,
    recordingStartedAtRef,
    removeJob,
    sessionStartedAtRef,
    sessionsByIdRef,
    updateStage,
    upsertJob,
    playStartCue,
  } = deps;

  const electronAPI =
    deps.electronAPI || (typeof window !== "undefined" ? window.electronAPI : undefined);

  return async (payload = {}) => {
    const audioManager = audioManagerRef.current;
    if (!audioManager) {
      return false;
    }

    const currentState = audioManager.getState();
    const session = normalizeTriggerPayload(payload);
    if (currentState.isRecording) {
      return false;
    }
    if (currentState.isProcessing && session.outputMode !== "clipboard") {
      return false;
    }

    logger.info(
      "Dictation start requested",
      {
        sessionId: session.sessionId,
        outputMode: session.outputMode,
        triggeredAt: session.triggeredAt,
        currentState,
      },
      "dictation"
    );

    const job = upsertJob(session.sessionId, {
      outputMode: session.outputMode,
      status: "recording",
      startedAt: Date.now(),
      recordedMs: null,
      provider: null,
      model: null,
    });

    sessionsByIdRef.current.set(session.sessionId, session);
    recordingSessionIdRef.current = session.sessionId;

    updateStage("starting", {
      outputMode: session.outputMode,
      sessionId: session.sessionId,
      jobId: job.jobId,
      message: session.outputMode === "clipboard" ? "Clipboard mode" : null,
    });

    if (session.outputMode === "insert" && electronAPI?.captureInsertionTarget) {
      try {
        const captureResult = await electronAPI.captureInsertionTarget();
        if (captureResult?.success && captureResult?.target?.hwnd) {
          session.insertionTarget = captureResult.target;
        }
      } catch (error) {
        logger.warn("Failed to capture insertion target", { error: error?.message }, "clipboard");
      }
    }

    const shouldForceNonStreaming = currentState.isProcessing && session.outputMode === "clipboard";
    const recordingContext = {
      sessionId: session.sessionId,
      jobId: job.jobId,
      outputMode: session.outputMode,
      triggeredAt: session.triggeredAt,
    };

    const shouldUseStreaming = !shouldForceNonStreaming && audioManager.shouldUseStreaming();
    logger.info(
      "Dictation start routing",
      {
        sessionId: session.sessionId,
        outputMode: session.outputMode,
        shouldForceNonStreaming,
        shouldUseStreaming,
      },
      "dictation"
    );

    const didStart = shouldUseStreaming
      ? await audioManager.startStreamingRecording(recordingContext)
      : await audioManager.startRecording(recordingContext);

    if (didStart) {
      activeSessionRef.current = session;
      sessionStartedAtRef.current = Date.now();
      recordingStartedAtRef.current = sessionStartedAtRef.current;
      logger.info(
        "Dictation recording started",
        {
          sessionId: session.sessionId,
          outputMode: session.outputMode,
          hotkeyToRecordingMs: Math.max(0, Date.now() - (session.triggeredAt || Date.now())),
          method: shouldUseStreaming ? "streaming" : "non-streaming",
        },
        "dictation"
      );
      updateStage("listening", {
        outputMode: session.outputMode,
        sessionId: session.sessionId,
        jobId: job.jobId,
        generatedChars: 0,
        generatedWords: 0,
        message: session.outputMode === "clipboard" ? "Clipboard mode" : null,
      });
      void playStartCue?.();
    } else {
      sessionsByIdRef.current.delete(session.sessionId);
      recordingSessionIdRef.current = null;
      removeJob(session.sessionId);
      logger.warn(
        "Dictation start failed",
        { sessionId: session.sessionId, outputMode: session.outputMode },
        "dictation"
      );
    }

    return didStart;
  };
};

export const createStopRecordingHandler = (deps) => {
  const {
    activeSessionRef,
    audioManagerRef,
    latestProgressRef,
    normalizeTriggerPayload,
    recordingSessionIdRef,
    upsertJob,
    playStopCue,
  } = deps;

  return async (payload = {}) => {
    const audioManager = audioManagerRef.current;
    if (!audioManager) {
      return false;
    }

    const currentState = audioManager.getState();
    if (!currentState.isRecording) {
      return false;
    }

    const normalizedPayload = normalizeTriggerPayload(payload);
    const requestedSessionId =
      typeof normalizedPayload?.sessionId === "string" && normalizedPayload.sessionId.trim()
        ? normalizedPayload.sessionId.trim()
        : null;
    const activeSessionId = activeSessionRef.current?.sessionId || null;
    const hasSessionMismatch = Boolean(requestedSessionId && activeSessionId && requestedSessionId !== activeSessionId);

    if (hasSessionMismatch) {
      logger.warn(
        "Stop payload session mismatch",
        {
          requestedSessionId,
          activeSessionId,
          currentState,
        },
        "dictation"
      );
    }

    if (!activeSessionRef.current) {
      activeSessionRef.current = normalizedPayload;
    } else if (normalizedPayload?.sessionId && normalizedPayload.sessionId === activeSessionRef.current.sessionId) {
      // Push-to-talk stop payload includes release timing; merge it into the active session.
      activeSessionRef.current = { ...activeSessionRef.current, ...normalizedPayload };
    }

    const session = activeSessionRef.current;
    const stopSource = normalizedPayload?.stopSource || (normalizedPayload?.releasedAt ? "released" : "manual");
    const stopReason = normalizedPayload?.stopReason || (normalizedPayload?.releasedAt ? "release" : "manual");

    logger.info(
      "Dictation stop requested",
      {
        sessionId: session?.sessionId,
        requestedSessionId,
        activeSessionId,
        stopSessionMismatch: hasSessionMismatch,
        outputMode: session?.outputMode,
        stopSource,
        stopReason,
        releasedAt: session?.releasedAt,
        startedAt: session?.startedAt,
        triggeredAt: session?.triggeredAt,
        currentState,
      },
      "dictation"
    );

    if (session?.sessionId) {
      const recordedMsSnapshot =
        typeof latestProgressRef.current?.recordedMs === "number" && latestProgressRef.current.recordedMs > 0
          ? Math.round(latestProgressRef.current.recordedMs)
          : null;

      upsertJob(session.sessionId, {
        status: currentState.isProcessing && session.outputMode === "clipboard" ? "queued" : "processing",
        ...(stopSource ? { stopSource } : {}),
        ...(stopReason ? { stopReason } : {}),
        ...(recordedMsSnapshot !== null ? { recordedMs: recordedMsSnapshot } : {}),
        stoppedAt: Date.now(),
      });
    }

    recordingSessionIdRef.current = null;

    if (currentState.isStreaming) {
      void playStopCue?.();
      return await audioManager.stopStreamingRecording();
    }

    const didStop = audioManager.stopRecording({
      reason: stopReason,
      source: stopSource,
      sessionId: session?.sessionId,
      outputMode: session?.outputMode,
    });

    if (didStop) {
      void playStopCue?.();
    }

    return didStop;
  };
};

