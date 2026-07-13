function flattenTranscriptionRow(row) {
  const meta = row?.meta || {};
  const timings = meta?.timings || {};
  return {
    id: row?.id,
    timestamp: row?.timestamp,
    text: row?.text || "",
    rawText: row?.raw_text || "",
    outputMode: meta.outputMode || "",
    status: meta.status || "",
    provider: meta.provider || meta.source || "",
    model: meta.model || "",
    source: meta.source || "",
    pasteSucceeded:
      meta.pasteSucceeded === true ? "true" : meta.pasteSucceeded === false ? "false" : "",
    clipboardSucceeded:
      meta.clipboardSucceeded === true ? "true" : meta.clipboardSucceeded === false ? "false" : "",
    deliveryStatus: meta.delivery?.status || "",
    error: meta.error || "",
    stopReason: meta.stopReason || timings.stopReason || "",
    stopSource: meta.stopSource || timings.stopSource || "",
    audioSizeBytes: timings.audioSizeBytes ?? "",
    audioFormat: timings.audioFormat ?? "",
    chunksCount: timings.chunksCount ?? "",
    hotkeyToStartCallMs: timings.hotkeyToStartCallMs ?? "",
    hotkeyToRecorderStartMs: timings.hotkeyToRecorderStartMs ?? "",
    rawWords: meta.textMetrics?.rawWords ?? "",
    cleanedWords: meta.textMetrics?.cleanedWords ?? "",
    recordMs: timings.recordDurationMs ?? timings.recordMs ?? "",
    transcribeMs: timings.transcriptionProcessingDurationMs ?? timings.transcribeDurationMs ?? "",
    cleanupMs: timings.reasoningProcessingDurationMs ?? timings.cleanupDurationMs ?? "",
    pasteMs: timings.pasteDurationMs ?? "",
    saveMs: timings.saveDurationMs ?? "",
    totalMs: timings.totalDurationMs ?? "",
  };
}

function escapeCsvValue(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
}

function serializeTranscriptionCsv(rows) {
  const headers = Object.keys(rows[0] || { id: "", timestamp: "", text: "" });
  const csvRows = [headers.join(",")];
  for (const row of rows) {
    csvRows.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
  }
  return csvRows.join("\n");
}

module.exports = {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
};
