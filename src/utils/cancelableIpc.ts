import { raceWithAbort, throwIfAborted } from "./retry";

const createRequestId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Math.random().toString(36).slice(2).padEnd(12, "0");
  return `fallback-${Date.now().toString(36)}-${random}`;
};

export async function invokeCancelableIpc<T>(
  signal: AbortSignal | null | undefined,
  invoke: (requestId: string) => Promise<T>
): Promise<T> {
  throwIfAborted(signal || undefined);
  const requestId = createRequestId();
  const cancel = () => {
    const cancellation = window.electronAPI?.cancelIpcRequest?.(requestId);
    void cancellation?.catch?.(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await raceWithAbort(invoke(requestId), signal || undefined);
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
