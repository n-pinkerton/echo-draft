import { describe, expect, it } from "vitest";

import {
  MAX_MOBILE_AUDIO_BYTES,
  MOBILE_AUDIO_MIME_TYPE,
  getMobileAudioFileName,
  getMobileManifestFileName,
  normalizeMobileInboxManifest,
} from "./mobileInboxContract.cjs";

const EXTERNAL_ID = "550e8400-e29b-41d4-a716-446655440000";

const makeManifest = () => ({
  version: 1,
  externalId: EXTERNAL_ID.toUpperCase(),
  audioFile: getMobileAudioFileName(EXTERNAL_ID),
  audioSha256: "A".repeat(64),
  sizeBytes: 1234,
  createdAt: "2026-07-18T02:03:04Z",
});

describe("mobile inbox manifest contract", () => {
  it("normalizes the one supported version and audio format", () => {
    expect(
      normalizeMobileInboxManifest(makeManifest(), getMobileManifestFileName(EXTERNAL_ID))
    ).toEqual({
      version: 1,
      externalId: EXTERNAL_ID,
      audioFile: `${EXTERNAL_ID}.m4a`,
      audioSha256: "a".repeat(64),
      sizeBytes: 1234,
      createdAt: "2026-07-18T02:03:04.000Z",
      mimeType: MOBILE_AUDIO_MIME_TYPE,
    });
  });

  it.each([
    ["missing manifest", null, getMobileManifestFileName(EXTERNAL_ID)],
    ["future protocol", { ...makeManifest(), version: 2 }, getMobileManifestFileName(EXTERNAL_ID)],
    ["invalid ID", { ...makeManifest(), externalId: "phone-1" }, "phone-1.ready.json"],
    ["mismatched manifest name", makeManifest(), "other.ready.json"],
    [
      "mismatched audio name",
      { ...makeManifest(), audioFile: "other.m4a" },
      getMobileManifestFileName(EXTERNAL_ID),
    ],
    [
      "unsupported audio type",
      { ...makeManifest(), audioFile: `${EXTERNAL_ID}.webm` },
      getMobileManifestFileName(EXTERNAL_ID),
    ],
    [
      "invalid hash",
      { ...makeManifest(), audioSha256: "not-a-hash" },
      getMobileManifestFileName(EXTERNAL_ID),
    ],
    ["empty audio", { ...makeManifest(), sizeBytes: 0 }, getMobileManifestFileName(EXTERNAL_ID)],
    [
      "oversized audio",
      { ...makeManifest(), sizeBytes: MAX_MOBILE_AUDIO_BYTES + 1 },
      getMobileManifestFileName(EXTERNAL_ID),
    ],
    [
      "invalid timestamp",
      { ...makeManifest(), createdAt: "later" },
      getMobileManifestFileName(EXTERNAL_ID),
    ],
  ])("rejects %s", (_label, manifest, fileName) => {
    expect(() => normalizeMobileInboxManifest(manifest, fileName)).toThrow();
  });
});
