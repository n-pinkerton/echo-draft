import { describe, expect, it } from "vitest";

import { getLowAudioRejection, summarizePcmAudioBuffer } from "./audioLevelAnalysis";

describe("audioLevelAnalysis", () => {
  it("flags long near-silent recordings", () => {
    const rejection = getLowAudioRejection(
      {
        available: true,
        durationSeconds: 18.9,
        peakDbFS: -43.7,
        rmsDbFS: -69.3,
      },
      { durationSeconds: 18.9 }
    );

    expect(rejection).toMatchObject({
      code: "LOW_AUDIO_LEVEL",
      durationSeconds: 18.9,
      peakDbFS: -43.7,
      rmsDbFS: -69.3,
    });
  });

  it("does not flag short clips or normal speech levels", () => {
    expect(
      getLowAudioRejection(
        { available: true, durationSeconds: 1.2, peakDbFS: -70, rmsDbFS: -80 },
        { durationSeconds: 1.2 }
      )
    ).toBeNull();

    expect(
      getLowAudioRejection(
        { available: true, durationSeconds: 18.9, peakDbFS: -18, rmsDbFS: -32 },
        { durationSeconds: 18.9 }
      )
    ).toBeNull();
  });

  it("summarizes decoded PCM amplitude", () => {
    const summary = summarizePcmAudioBuffer({
      duration: 2,
      sampleRate: 48000,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0, 0.5, -0.25, 0.25]),
    });

    expect(summary).toMatchObject({
      available: true,
      durationSeconds: 2,
      sampleRate: 48000,
      channelCount: 1,
      peakDbFS: -6,
    });
    expect(summary.rmsDbFS).toBeGreaterThan(-11);
    expect(summary.rmsDbFS).toBeLessThan(-10);
  });
});
