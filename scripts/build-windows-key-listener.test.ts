import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { sha256, sha256Source, verifyPinnedArtifacts } = require("./build-windows-key-listener.js");

const sourceBuffer = Buffer.from("reviewed source");
const binaryBuffer = Buffer.from([0, 1, 2, 3, 4, 5]);
const manifest = {
  version: "test-version",
  sourceSha256: sha256Source(sourceBuffer),
  binarySha256: sha256(binaryBuffer),
};

describe("Windows key listener integrity", () => {
  it("accepts the exact pinned source and executable", () => {
    expect(verifyPinnedArtifacts({ manifest, sourceBuffer, binaryBuffer })).toEqual({
      version: "test-version",
      sourceHash: manifest.sourceSha256,
      binaryHash: manifest.binarySha256,
    });
  });

  it("rejects a recent-but-stale or tampered executable", () => {
    expect(() =>
      verifyPinnedArtifacts({ manifest, sourceBuffer, binaryBuffer: Buffer.from("tampered") })
    ).toThrow(/executable hash mismatch/i);
  });

  it("rejects source changes that are not bound to a reviewed executable", () => {
    expect(() =>
      verifyPinnedArtifacts({ manifest, sourceBuffer: Buffer.from("changed"), binaryBuffer })
    ).toThrow(/source hash mismatch/i);
  });

  it("binds source semantics independently of checkout line endings", () => {
    const lf = Buffer.from("line one\nline two\n");
    const crlf = Buffer.from("line one\r\nline two\r\n");

    expect(sha256Source(lf)).toBe(sha256Source(crlf));
  });

  it("fails when the pinned executable is unavailable", () => {
    expect(() => verifyPinnedArtifacts({ manifest, sourceBuffer, binaryBuffer: null })).toThrow(
      /executable is missing/i
    );
  });
});
