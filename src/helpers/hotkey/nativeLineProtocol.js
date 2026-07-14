const DEFAULT_MAX_BUFFER_LENGTH = 4_096;

/**
 * Frame the native helper's newline-delimited protocol across arbitrary stdout chunks.
 * Child-process streams do not preserve write boundaries, so READY or KEY_DOWN may arrive
 * split across multiple data events. Malformed output is bounded to avoid retaining an
 * indefinitely growing partial line.
 */
function createNativeLineDecoder(
  onLine,
  { maxBufferLength = DEFAULT_MAX_BUFFER_LENGTH, onOverflow = null } = {}
) {
  if (typeof onLine !== "function") {
    throw new TypeError("createNativeLineDecoder requires an onLine callback");
  }

  let buffer = "";

  return {
    push(chunk) {
      buffer += String(chunk ?? "");

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        onLine(line);
        newlineIndex = buffer.indexOf("\n");
      }

      if (buffer.length > maxBufferLength) {
        const discardedLength = buffer.length;
        buffer = "";
        onOverflow?.(discardedLength);
      }
    },

    clear() {
      buffer = "";
    },
  };
}

module.exports = {
  DEFAULT_MAX_BUFFER_LENGTH,
  createNativeLineDecoder,
};
