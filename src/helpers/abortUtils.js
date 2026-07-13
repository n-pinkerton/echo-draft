const createAbortError = (message = "Request cancelled") => {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "REQUEST_CANCELLED";
  return error;
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw createAbortError();
};

const abortableDelay = (delayMs, signal) => {
  throwIfAborted(signal);
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const raceWithAbort = async (promise, signal) => {
  throwIfAborted(signal);
  if (!signal) return await promise;

  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      const onAbort = () => reject(createAbortError());
      signal.addEventListener("abort", onAbort, { once: true });
      promise.finally(() => signal.removeEventListener("abort", onAbort)).catch(() => {});
    }),
  ]);
};

module.exports = { abortableDelay, createAbortError, raceWithAbort, throwIfAborted };
