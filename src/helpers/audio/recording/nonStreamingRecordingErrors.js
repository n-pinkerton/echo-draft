export const describeRecordingStartError = (error) => {
  const errorMessage =
    error?.message ??
    (typeof error === "string"
      ? error
      : typeof error?.toString === "function"
        ? error.toString()
        : String(error));

  const errorName = error?.name;

  let title = "Recording Error";
  let description = `Failed to access microphone: ${errorMessage}`;

  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    title = "Microphone Access Denied";
    description = "Please grant microphone permission in your system settings and try again.";
  } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    title = "No Microphone Found";
    description = "No microphone was detected. Please connect a microphone and try again.";
  } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    title = "Microphone In Use";
    description =
      "The microphone is being used by another application. Please close other apps and try again.";
  }

  return { title, description, errorMessage, errorName };
};

