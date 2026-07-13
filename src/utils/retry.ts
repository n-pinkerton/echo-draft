import { RETRY_CONFIG } from "../config/constants";

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
  signal?: AbortSignal;
}

export const createAbortError = (): Error => {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
};

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw createAbortError();
};

export const raceWithAbort = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  throwIfAborted(signal);
  if (!signal) return await promise;

  return await new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
};

const waitForRetryDelay = async (delay: number, signal?: AbortSignal): Promise<void> => {
  throwIfAborted(signal);
  if (delay <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delay);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
  });
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.MAX_RETRIES,
    initialDelay = RETRY_CONFIG.INITIAL_DELAY,
    maxDelay = RETRY_CONFIG.MAX_DELAY,
    backoffMultiplier = RETRY_CONFIG.BACKOFF_MULTIPLIER,
    shouldRetry = () => true,
    signal,
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (
        signal?.aborted ||
        (error as Error)?.name === "AbortError" ||
        attempt === maxRetries ||
        !shouldRetry(error)
      ) {
        if (signal?.aborted && (error as Error)?.name !== "AbortError") {
          throw createAbortError();
        }
        throw error;
      }

      // Wait before retrying with exponential backoff
      await waitForRetryDelay(delay, signal);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

// Specific retry strategy for API calls
export function createApiRetryStrategy() {
  return {
    maxRetries: 1,
    shouldRetry: (error: any) => {
      if (error?.name === "AbortError") return false;
      // Retry transient request failures, including throttling and server errors.
      const status = error.response?.status ?? error.status;
      if (typeof status !== "number") return true; // Network error
      return status === 408 || status === 429 || (status >= 500 && status < 600);
    },
  };
}

// Specific retry strategy for file operations
export function createFileRetryStrategy() {
  return {
    shouldRetry: (error: any) => {
      // Retry on temporary file system errors
      const retriableErrors = ["EBUSY", "ENOENT", "EPERM", "EAGAIN"];
      return retriableErrors.includes(error.code);
    },
    maxRetries: 2,
    initialDelay: 500,
  };
}
