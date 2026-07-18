const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  readStablePathStats,
  readStableRegularFile,
  sameFileIdentity,
  sameStableFile,
} = require("./files/stableFileRead");
const {
  MAX_MOBILE_AUDIO_BYTES,
  MAX_MOBILE_MANIFEST_BYTES,
  normalizeMobileInboxManifest,
} = require("./mobileInboxContract.cjs");

const sha256 = (cryptoImpl, buffer) =>
  cryptoImpl.createHash("sha256").update(buffer).digest("hex");

const comparablePath = (pathImpl, value) => {
  const resolved = pathImpl.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const stablePathSignature = (stats) =>
  [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs, stats.mode].join(":");

const sameClaimedFile = (left, right) =>
  Boolean(
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.mode === right.mode
  );

class MobileInboxFileStore {
  constructor(
    { fsImpl = fs, pathImpl = path, cryptoImpl = crypto, platform = process.platform } = {}
  ) {
    this.fs = fsImpl;
    this.path = pathImpl;
    this.crypto = cryptoImpl;
    this.platform = platform;
  }

  async canonicalizeFolder(folderPath) {
    const candidate = typeof folderPath === "string" ? folderPath.trim() : "";
    const resolved = candidate ? this.path.resolve(candidate) : "";
    if (!resolved || !this.path.isAbsolute(resolved)) {
      throw new Error("Mobile inbox folder is invalid");
    }
    const stats = await this.fs.promises.lstat(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Mobile inbox path must be a regular folder");
    }
    return this.path.resolve(await this.fs.promises.realpath(resolved));
  }

  async snapshotRoot(folderPath) {
    const rootPath = this.path.resolve(folderPath);
    const stats = await this.fs.promises.lstat(rootPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Mobile inbox root must be a regular folder");
    }
    const realPath = this.path.resolve(await this.fs.promises.realpath(rootPath));
    if (comparablePath(this.path, realPath) !== comparablePath(this.path, rootPath)) {
      throw new Error("Mobile inbox root changed identity");
    }
    return { path: rootPath, realPath, stats };
  }

  async assertRoot(root) {
    const current = await this.fs.promises.lstat(root.path);
    const realPath = this.path.resolve(await this.fs.promises.realpath(root.path));
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      comparablePath(this.path, realPath) !== comparablePath(this.path, root.realPath) ||
      !sameFileIdentity(root.stats, current)
    ) {
      throw new Error("Mobile inbox root changed while an item was processing");
    }
  }

  async listManifests(root) {
    const entries = await this.fs.promises.readdir(root.path, { withFileTypes: true });
    await this.assertRoot(root);
    return entries
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.ready\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  async readManifest(root, manifestFileName) {
    const filePath = this.path.join(root.path, manifestFileName);
    let buffer;
    let stats;
    try {
      await this.assertRoot(root);
      ({ buffer, stats } = await readStableRegularFile(this.fs, filePath, {
        maxBytes: MAX_MOBILE_MANIFEST_BYTES,
        minBytes: 2,
        rejectSymbolicLinks: true,
      }));
      await this.assertRoot(root);
    } catch (error) {
      try {
        await this.assertRoot(root);
        const pathStats = await readStablePathStats(this.fs, filePath);
        await this.assertRoot(root);
        error.mobileInboxEvidence = {
          fileName: manifestFileName,
          sha256: null,
          stats: pathStats,
        };
        error.mobileInboxSignature = `manifest-path:${stablePathSignature(pathStats)}`;
      } catch {}
      throw error;
    }
    const evidence = {
      fileName: manifestFileName,
      sha256: sha256(this.crypto, buffer),
      stats,
    };
    try {
      return {
        manifest: normalizeMobileInboxManifest(
          JSON.parse(buffer.toString("utf8")),
          manifestFileName
        ),
        evidence,
      };
    } catch (error) {
      error.mobileInboxEvidence = evidence;
      error.mobileInboxSignature = `manifest:${evidence.sha256}`;
      throw error;
    }
  }

  async readAudio(root, manifest) {
    const filePath = this.path.join(root.path, manifest.audioFile);
    await this.assertRoot(root);
    const { buffer, stats } = await readStableRegularFile(this.fs, filePath, {
      maxBytes: MAX_MOBILE_AUDIO_BYTES,
      rejectSymbolicLinks: true,
    });
    await this.assertRoot(root);
    if (stats.size !== manifest.sizeBytes) {
      const error = new Error("Mobile audio has not finished syncing");
      error.mobileInboxSignature = `audio-size:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
      throw error;
    }
    const actualHash = sha256(this.crypto, buffer);
    return {
      buffer,
      evidence: {
        fileName: manifest.audioFile,
        sha256: actualHash,
        stats,
      },
    };
  }

  async _assertPath(root, filePath, evidence, maxBytes, { claimed = false } = {}) {
    await this.assertRoot(root);
    const hasExpectedIdentity = (stats) =>
      claimed ? sameClaimedFile(evidence.stats, stats) : sameStableFile(evidence.stats, stats);
    if (!evidence.sha256) {
      const currentStats = await readStablePathStats(this.fs, filePath);
      await this.assertRoot(root);
      if (!hasExpectedIdentity(currentStats)) {
        throw new Error("Mobile inbox input changed after validation");
      }
      return filePath;
    }
    const current = await readStableRegularFile(this.fs, filePath, {
      maxBytes,
      rejectSymbolicLinks: true,
    });
    await this.assertRoot(root);
    if (
      !hasExpectedIdentity(current.stats) ||
      sha256(this.crypto, current.buffer) !== evidence.sha256
    ) {
      throw new Error("Mobile inbox input changed after validation");
    }
    return filePath;
  }

  async _restoreClaim(root, claimedPath, sourcePath) {
    await this.assertRoot(root);
    if (this.platform === "win32") {
      try {
        await this.fs.promises.rename(claimedPath, sourcePath);
        return true;
      } catch (error) {
        if (this.fs.existsSync(sourcePath)) return false;
        throw error;
      }
    }
    try {
      await this.fs.promises.link(claimedPath, sourcePath);
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    }
    try {
      await this.fs.promises.unlink(claimedPath);
    } catch {
      // The original pathname is restored; a retained hard link is safer than data loss.
    }
    return true;
  }

  async _claimFile(root, evidence, maxBytes) {
    await this.assertRoot(root);
    const sourcePath = this.path.join(root.path, evidence.fileName);
    const claimedPath = this.path.join(
      root.path,
      `.echodraft-claim-${this.crypto.randomUUID()}-${evidence.fileName}`
    );
    await this.fs.promises.rename(sourcePath, claimedPath);
    try {
      await this._assertPath(root, claimedPath, evidence, maxBytes, { claimed: true });
      return { claimedPath, sourcePath };
    } catch (error) {
      try {
        await this._restoreClaim(root, claimedPath, sourcePath);
      } catch {}
      throw error;
    }
  }

  async _removeClaimed(root, claim) {
    try {
      await this.fs.promises.unlink(claim.claimedPath);
    } catch (error) {
      try {
        await this._restoreClaim(root, claim.claimedPath, claim.sourcePath);
      } catch {}
      throw error;
    }
  }

  async removeCompleted(root, { manifestEvidence, audioEvidence = null }) {
    if (audioEvidence) {
      await this._assertPath(
        root,
        this.path.join(root.path, audioEvidence.fileName),
        audioEvidence,
        MAX_MOBILE_AUDIO_BYTES
      );
    }
    await this._assertPath(
      root,
      this.path.join(root.path, manifestEvidence.fileName),
      manifestEvidence,
      MAX_MOBILE_MANIFEST_BYTES
    );

    const manifestClaim = await this._claimFile(
      root,
      manifestEvidence,
      MAX_MOBILE_MANIFEST_BYTES
    );
    try {
      if (audioEvidence) {
        const audioClaim = await this._claimFile(root, audioEvidence, MAX_MOBILE_AUDIO_BYTES);
        await this._removeClaimed(root, audioClaim);
      }
      await this._removeClaimed(root, manifestClaim);
    } catch (error) {
      try {
        await this._restoreClaim(root, manifestClaim.claimedPath, manifestClaim.sourcePath);
      } catch {}
      throw error;
    }
  }

  async quarantineManifest(root, manifestEvidence) {
    const claim = await this._claimFile(
      root,
      manifestEvidence,
      MAX_MOBILE_MANIFEST_BYTES
    );
    const baseTarget = this.path.join(
      root.path,
      manifestEvidence.fileName.replace(/\.ready\.json$/i, ".error.json")
    );
    const target = this.fs.existsSync(baseTarget)
      ? baseTarget.replace(/\.error\.json$/i, `.error-${Date.now()}.json`)
      : baseTarget;
    try {
      await this.fs.promises.rename(claim.claimedPath, target);
    } catch (error) {
      try {
        await this._restoreClaim(root, claim.claimedPath, claim.sourcePath);
      } catch {}
      throw error;
    }
    return target;
  }
}

module.exports = {
  MobileInboxFileStore,
  sameStableFile,
};
