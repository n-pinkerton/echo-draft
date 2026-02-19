/**
 * ProcessingQueue
 *
 * Runs audio transcription jobs sequentially.
 * Keeps queueing separate from the transcription pipeline itself.
 */
export class ProcessingQueue {
  /**
   * @param {{
   *   logger: any,
   *   getIsProcessing: () => boolean,
   *   setIsProcessing: (value: boolean) => void,
   *   setActiveContext: (context: any) => void,
   *   processJob: (audioBlob: Blob, metadata: any, context: any) => Promise<void>,
   * }} deps
   */
  constructor(deps) {
    this.logger = deps.logger;
    this.getIsProcessing = deps.getIsProcessing;
    this.setIsProcessing = deps.setIsProcessing;
    this.setActiveContext = deps.setActiveContext;
    this.processJob = deps.processJob;

    /** @type {{audioBlob: Blob, metadata: any, context: any}[]} */
    this._queue = [];
    /** @type {Promise<void> | null} */
    this._runner = null;
  }

  get length() {
    return this._queue.length;
  }

  enqueue(audioBlob, metadata = {}, context = null) {
    this._queue.push({ audioBlob, metadata, context });
    this.startIfPossible();
  }

  cancel() {
    this._queue = [];
    this.setActiveContext(null);
  }

  whenIdle() {
    return this._runner || Promise.resolve();
  }

  startIfPossible() {
    if (this._runner || this._queue.length === 0) {
      return;
    }

    // Another processing pipeline (e.g., streaming finalize) is active.
    // We'll start as soon as that processing ends.
    if (this.getIsProcessing()) {
      return;
    }

    this.setIsProcessing(true);

    this._runner = (async () => {
      while (this.getIsProcessing() && this._queue.length > 0) {
        const job = this._queue.shift();
        if (!job) continue;

        this.setActiveContext(job.context || null);
        await this.processJob(job.audioBlob, job.metadata, job.context);
        this.setActiveContext(null);
      }
    })()
      .catch((error) => {
        this.logger.error(
          "Processing queue runner failed",
          { error: error?.message || String(error) },
          "audio"
        );
      })
      .finally(() => {
        this._runner = null;
        this.setActiveContext(null);
        if (this.getIsProcessing()) {
          this.setIsProcessing(false);
        }
      });
  }
}

