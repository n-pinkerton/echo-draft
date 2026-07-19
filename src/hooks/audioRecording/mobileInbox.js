import {
  MAX_MOBILE_AUDIO_BYTES,
  MOBILE_AUDIO_MIME_TYPE,
  UUID_PATTERN,
} from "../../helpers/mobileInboxContract.cjs";

const asUint8Array = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

export const getMobileInboxRequestId = (context) => {
  const requestId =
    typeof context?.mobileInboxRequestId === "string"
      ? context.mobileInboxRequestId.toLowerCase()
      : typeof context?.requestId === "string"
        ? context.requestId.toLowerCase()
        : "";
  return UUID_PATTERN.test(requestId) ? requestId : null;
};

export const getMobileInboxExternalId = (context) => {
  const externalId =
    typeof context?.mobileInboxExternalId === "string"
      ? context.mobileInboxExternalId.toLowerCase()
      : typeof context?.externalId === "string"
        ? context.externalId.toLowerCase()
        : "";
  return UUID_PATTERN.test(externalId) ? externalId : null;
};

export const reportMobileInboxFailure = (electronAPI, context) => {
  const requestId = getMobileInboxRequestId(context);
  if (!requestId) return false;
  void electronAPI
    ?.completeMobileInboxItem?.(requestId, { success: false })
    ?.catch?.(() => {});
  return true;
};

export const getMobileInboxTerminalProgress = (completed) =>
  completed
    ? {
        stage: "done",
        stageLabel: "Mobile memo processed",
        message: "Processing complete.",
        canCancel: false,
      }
    : {
        stage: "error",
        stageLabel: "Mobile memo will retry",
        message: "Processing did not finish; EchoDraft will retry automatically.",
        canCancel: false,
      };

export const canShowMobileInboxTerminal = ({
  recordingSessionId,
  progressSessionId,
  mobileSessionId,
}) =>
  !recordingSessionId &&
  (!progressSessionId || (mobileSessionId && progressSessionId === mobileSessionId));

export const mobileInboxRequestOwnsJob = (job, requestId) =>
  !job?.mobileInboxRequestId || job.mobileInboxRequestId === requestId;

export const mobileInboxRequestOwnsSession = (
  mobileInboxRequestBySessionIdRef,
  sessionId,
  requestId,
  fallbackJob = null
) => {
  if (mobileInboxRequestBySessionIdRef?.current) {
    return mobileInboxRequestBySessionIdRef.current.get(sessionId) === requestId;
  }
  return mobileInboxRequestOwnsJob(fallbackJob, requestId);
};

export const enqueueMobileInboxItem = ({
  audioManager,
  payload,
  removeJob,
  upsertJob,
  now = Date.now,
}) => {
  const requestId = getMobileInboxRequestId(payload);
  const externalId = getMobileInboxExternalId(payload) || "";
  const createdAtMs = Date.parse(payload?.createdAt || "");
  const bytes = asUint8Array(payload?.data);
  if (
    !audioManager ||
    !requestId ||
    !UUID_PATTERN.test(externalId) ||
    payload?.mimeType !== MOBILE_AUDIO_MIME_TYPE ||
    !Number.isFinite(createdAtMs) ||
    !bytes ||
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_MOBILE_AUDIO_BYTES
  ) {
    throw new Error("Invalid mobile inbox processing payload");
  }

  const startedAt = now();
  const job = upsertJob(externalId, {
    mobileInboxRequestId: requestId,
    outputMode: "mobile-todo",
    startedAt,
    status: "queued",
  });
  const context = {
    sessionId: externalId,
    jobId: job.jobId,
    outputMode: "mobile-todo",
    mobileInboxRequestId: requestId,
    mobileInboxExternalId: externalId,
    createdAt: new Date(createdAtMs).toISOString(),
    triggeredAt: createdAtMs,
  };

  try {
    audioManager.enqueueProcessingJob(
      new Blob([bytes], { type: MOBILE_AUDIO_MIME_TYPE }),
      { source: "android" },
      context
    );
  } catch (error) {
    removeJob(externalId);
    throw error;
  }
  return context;
};

export const createMobileInboxCompletion = (result, job) => {
  if (result?.success !== true) return { success: false };
  return {
    success: true,
    text: result.text,
    rawText: result.rawText || result.text,
    title: result.title,
    source: result.source,
    provider: job?.provider || result.provider || result.source,
    model: job?.model || result.model,
    cleanup: result.cleanup,
    timings: result.timings,
  };
};
