const crypto = require("node:crypto");

const CLEANUP_STEPS = [
  "restoreClipboard",
  "destroyWindow",
  "restoreForeground",
  "verifyClipboard",
  "verifyForeground",
];
const DEFAULT_CLEANUP_STEP_TIMEOUT_MS = 6_500;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const OPERATION_CANCELLATION_TIMEOUT_MS = 2_000;

const fingerprintBuffer = (value) => {
  if (!Buffer.isBuffer(value)) {
    return null;
  }
  return {
    bytes: value.length,
    sha256: crypto.createHash("sha256").update(value).digest("hex"),
  };
};

const fingerprintText = (value) => fingerprintBuffer(Buffer.from(String(value || ""), "utf8"));

const fingerprintClipboardSnapshot = (snapshot = {}) => ({
  text: fingerprintText(snapshot.text),
  html: fingerprintText(snapshot.html),
  rtf: fingerprintText(snapshot.rtf),
  imagePng: fingerprintBuffer(snapshot.imagePng),
  formats: (Array.isArray(snapshot.formats) ? snapshot.formats : [])
    .filter((entry) => entry?.format && Buffer.isBuffer(entry.buffer))
    .map((entry) => ({
      format: String(entry.format),
      ...fingerprintBuffer(entry.buffer),
    }))
    .sort(
      (left, right) =>
        left.format.localeCompare(right.format) ||
        left.bytes - right.bytes ||
        left.sha256.localeCompare(right.sha256)
    ),
});

const clipboardSnapshotsMatch = (left, right) =>
  JSON.stringify(fingerprintClipboardSnapshot(left)) ===
  JSON.stringify(fingerprintClipboardSnapshot(right));

const clipboardSnapshotShape = (snapshot = {}) => {
  const fingerprint = fingerprintClipboardSnapshot(snapshot);
  return {
    textBytes: fingerprint.text?.bytes ?? null,
    htmlBytes: fingerprint.html?.bytes ?? null,
    rtfBytes: fingerprint.rtf?.bytes ?? null,
    imageBytes: fingerprint.imagePng?.bytes ?? null,
    formats: fingerprint.formats.map(({ format, bytes }) => ({ format, bytes })),
  };
};

const sameInsertionTargetIdentity = (left, right) =>
  Number(left?.hwnd) === Number(right?.hwnd) &&
  Number(left?.pid) === Number(right?.pid) &&
  String(left?.processStartTimeUtcTicks || "") === String(right?.processStartTimeUtcTicks || "");

const isVerifiedSmokeResult = (result) =>
  result?.success === true &&
  result?.userStateRestored === true &&
  result?.foregroundRecoveryExercised === true &&
  result?.stackedInsertionsVerified === true &&
  Number(result?.insertedJobs) >= 2;

const runBoundedStep = (step, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish({ status: "timeout" }), timeoutMs);

    Promise.resolve()
      .then(() => step())
      .then(
        (value) => finish({ status: "fulfilled", value }),
        () => finish({ status: "rejected" })
      );
  });

async function runIndependentCleanup(steps = {}, options = {}) {
  const failures = [];
  const requestedTimeoutMs = Number(options.stepTimeoutMs);
  const stepTimeoutMs =
    Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? requestedTimeoutMs
      : DEFAULT_CLEANUP_STEP_TIMEOUT_MS;
  for (const stepName of CLEANUP_STEPS) {
    const step = steps[stepName];
    if (typeof step !== "function") {
      continue;
    }
    const outcome = await runBoundedStep(step, stepTimeoutMs);
    if (outcome.status !== "fulfilled" || outcome.value === false) {
      failures.push(stepName);
    }
  }
  return {
    success: failures.length === 0,
    failures,
  };
}

async function runWithIndependentCleanup(operation, cleanupSteps, options = {}) {
  let operationError = null;
  let operationResult;
  const requestedOperationTimeoutMs = Number(options.operationTimeoutMs);
  const operationTimeoutMs =
    Number.isFinite(requestedOperationTimeoutMs) && requestedOperationTimeoutMs > 0
      ? requestedOperationTimeoutMs
      : DEFAULT_OPERATION_TIMEOUT_MS;
  const controller = new AbortController();
  let operationTimer = null;
  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .then(
      (value) => ({ status: "fulfilled", value }),
      (error) => ({ status: "rejected", error })
    );
  const timeoutPromise = new Promise((resolve) => {
    operationTimer = setTimeout(() => resolve({ status: "timeout" }), operationTimeoutMs);
  });
  const operationOutcome = await Promise.race([operationPromise, timeoutPromise]);
  if (operationTimer) clearTimeout(operationTimer);

  if (operationOutcome.status === "fulfilled") {
    operationResult = operationOutcome.value;
  } else if (operationOutcome.status === "rejected") {
    operationError = operationOutcome.error;
  } else {
    controller.abort();
    if (typeof options.cancelOperation === "function") {
      await runBoundedStep(options.cancelOperation, OPERATION_CANCELLATION_TIMEOUT_MS);
    }
    operationError = new Error("The smoke-test operation timed out before cleanup.");
    operationError.code = "WINDOWS_PASTE_SMOKE_OPERATION_TIMEOUT";
  }

  const cleanup = await runIndependentCleanup(cleanupSteps, options);
  return { cleanup, operationError, operationResult };
}

module.exports = {
  CLEANUP_STEPS,
  DEFAULT_CLEANUP_STEP_TIMEOUT_MS,
  DEFAULT_OPERATION_TIMEOUT_MS,
  OPERATION_CANCELLATION_TIMEOUT_MS,
  clipboardSnapshotShape,
  clipboardSnapshotsMatch,
  fingerprintClipboardSnapshot,
  isVerifiedSmokeResult,
  runIndependentCleanup,
  runWithIndependentCleanup,
  sameInsertionTargetIdentity,
};
