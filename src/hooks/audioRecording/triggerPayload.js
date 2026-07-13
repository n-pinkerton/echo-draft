export const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const normalizeTriggerPayload = (payload = {}, deps = {}) => {
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  const createId =
    typeof deps.createSessionId === "function" ? deps.createSessionId : createSessionId;

  const outputMode = payload?.outputMode === "clipboard" ? "clipboard" : "insert";
  const sessionId =
    typeof payload?.sessionId === "string" && payload.sessionId.trim()
      ? payload.sessionId
      : createId();
  const triggeredAt =
    typeof payload?.triggeredAt === "number" && Number.isFinite(payload.triggeredAt)
      ? payload.triggeredAt
      : now();
  const startedAt =
    typeof payload?.startedAt === "number" && Number.isFinite(payload.startedAt)
      ? payload.startedAt
      : null;
  const releasedAt =
    typeof payload?.releasedAt === "number" && Number.isFinite(payload.releasedAt)
      ? payload.releasedAt
      : null;
  return {
    outputMode,
    sessionId,
    triggeredAt,
    startedAt,
    releasedAt,
    // Insertion targets are issued only by the main process after recording starts. Never accept
    // window handles or capabilities from a trigger payload.
    insertionTarget: null,
    stopReason: typeof payload?.stopReason === "string" ? payload.stopReason.trim() : null,
    stopSource: typeof payload?.stopSource === "string" ? payload.stopSource.trim() : null,
  };
};
