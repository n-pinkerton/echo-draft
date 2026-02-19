/**
 * StreamingWorkletManager
 *
 * Owns the AudioWorklet module source, blob URL, and "flush waiter" lifecycle.
 * Keeps AudioManager smaller and keeps worklet-specific logic out of the orchestration layer.
 */
export class StreamingWorkletManager {
  /**
   * @param {{
   *   logger: any,
   *   flushDoneMessage: string,
   *   shouldForward: () => boolean,
   *   onAudioChunk: (buffer: ArrayBuffer) => void,
   * }} deps
   */
  constructor(deps) {
    this.logger = deps.logger;
    this.flushDoneMessage = deps.flushDoneMessage;
    this.shouldForward = deps.shouldForward;
    this.onAudioChunk = deps.onAudioChunk;

    this._workletBlobUrl = null;
    this._flushWaiter = null;
  }

  getWorkletBlobUrl() {
    if (this._workletBlobUrl) return this._workletBlobUrl;

    const code = `
const BUFFER_SIZE = 800;
const FLUSH_DONE = ${JSON.stringify(this.flushDoneMessage)};
class PCMStreamingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(BUFFER_SIZE);
    this._offset = 0;
    this._stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        if (this._offset > 0) {
          const partial = this._buffer.slice(0, this._offset);
          this.port.postMessage(partial.buffer, [partial.buffer]);
          this._buffer = new Int16Array(BUFFER_SIZE);
          this._offset = 0;
        }
        this.port.postMessage(FLUSH_DONE);
        this._stopped = true;
      }
    };
  }
  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this._buffer[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= BUFFER_SIZE) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(BUFFER_SIZE);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-streaming-processor", PCMStreamingProcessor);
`;

    this._workletBlobUrl = URL.createObjectURL(
      new Blob([code], { type: "application/javascript" })
    );
    return this._workletBlobUrl;
  }

  dispose() {
    this.resolveFlushWaiter();
    if (this._workletBlobUrl) {
      try {
        URL.revokeObjectURL(this._workletBlobUrl);
      } catch {
        // ignore
      }
      this._workletBlobUrl = null;
    }
  }

  createFlushWaiter() {
    // Ensure any previous waiter can't hang.
    this.resolveFlushWaiter();

    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });

    this._flushWaiter = { promise, resolve };
    return this._flushWaiter;
  }

  resolveFlushWaiter() {
    if (this._flushWaiter?.resolve) {
      try {
        this._flushWaiter.resolve();
      } catch {
        // ignore
      }
    }
    this._flushWaiter = null;
  }

  handleMessage(event) {
    if (!event) return;

    if (event.data === this.flushDoneMessage) {
      this.resolveFlushWaiter();
      return;
    }

    if (!this.shouldForward()) {
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      try {
        this.onAudioChunk(event.data);
      } catch (error) {
        this.logger.debug(
          "Streaming audio chunk handler failed",
          { error: error?.message || String(error) },
          "streaming"
        );
      }
    }
  }
}

