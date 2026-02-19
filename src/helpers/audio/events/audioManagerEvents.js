import logger from "../../../utils/logger";

export function emitStateChange(manager, nextState) {
  try {
    manager.onStateChange?.(nextState);
  } catch (error) {
    logger.error(
      "onStateChange handler failed",
      {
        error: error?.message || String(error),
        stack: error?.stack,
        nextState,
      },
      "audio"
    );
  }
}

export function emitError(manager, payload, caughtError = null) {
  try {
    manager.onError?.(payload);
  } catch (handlerError) {
    logger.error(
      "onError handler failed",
      {
        handlerError: handlerError?.message || String(handlerError),
        handlerStack: handlerError?.stack,
        payload,
        caughtError:
          caughtError instanceof Error
            ? { message: caughtError.message, name: caughtError.name, stack: caughtError.stack }
            : caughtError,
      },
      "audio"
    );
  }
}

export function emitProgress(manager, event = {}) {
  const payload = {
    timestamp: Date.now(),
    ...event,
  };

  const stage = typeof payload.stage === "string" ? payload.stage : null;
  if (manager.activeProcessingContext && stage && stage !== "listening") {
    if (!payload.context) {
      payload.context = manager.activeProcessingContext;
    }
    if (payload.jobId === undefined && manager.activeProcessingContext.jobId !== undefined) {
      payload.jobId = manager.activeProcessingContext.jobId;
    }
  }

  try {
    manager.onProgress?.(payload);
  } catch (error) {
    logger.error(
      "onProgress handler failed",
      {
        error: error?.message || String(error),
        stack: error?.stack,
        payload,
      },
      "pipeline"
    );
  }
}

