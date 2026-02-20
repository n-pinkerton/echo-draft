import { describe, expect, it } from "vitest";
import { describeRecordingStartError } from "./nonStreamingRecordingErrors";

describe("describeRecordingStartError", () => {
  it("maps permission-denied errors", () => {
    expect(describeRecordingStartError({ name: "NotAllowedError", message: "denied" })).toMatchObject(
      {
        title: "Microphone Access Denied",
        description: "Please grant microphone permission in your system settings and try again.",
      }
    );
  });

  it("maps not-found errors", () => {
    expect(describeRecordingStartError({ name: "NotFoundError", message: "missing" })).toMatchObject({
      title: "No Microphone Found",
      description: "No microphone was detected. Please connect a microphone and try again.",
    });
  });

  it("maps in-use errors", () => {
    expect(describeRecordingStartError({ name: "NotReadableError", message: "busy" })).toMatchObject({
      title: "Microphone In Use",
      description:
        "The microphone is being used by another application. Please close other apps and try again.",
    });
  });

  it("falls back to a generic message", () => {
    expect(describeRecordingStartError({ name: "OtherError", message: "boom" })).toMatchObject({
      title: "Recording Error",
      description: "Failed to access microphone: boom",
      errorMessage: "boom",
      errorName: "OtherError",
    });
  });
});

