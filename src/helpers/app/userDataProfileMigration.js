const fs = require("fs");
const path = require("path");

const PROFILE_MIGRATION_MARKER = ".echodraft-profile-migrated.json";
const ESTABLISHED_DB_BYTES = 65536;
const ESTABLISHED_LOCAL_STORAGE_BYTES = 8192;
const IMPORTANT_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_REASONING_API_KEY",
];
const VOLATILE_PROFILE_ENTRIES = new Set([
  "blob_storage",
  "Cache",
  "Code Cache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "lockfile",
  "logs",
]);

function getCandidateUserDataPaths(appDataPath, platform, currentPath) {
  const candidates = [];

  if (platform === "win32") {
    candidates.push(
      path.join(appDataPath, "EchoDraft"),
      path.join(appDataPath, "echodraft"),
      path.join(appDataPath, "open-whispr")
    );
  } else if (platform === "darwin") {
    candidates.push(
      path.join(appDataPath, "EchoDraft"),
      path.join(appDataPath, "echodraft"),
      path.join(appDataPath, "open-whispr")
    );
  } else {
    candidates.push(
      path.join(appDataPath, "EchoDraft"),
      path.join(appDataPath, "echodraft"),
      path.join(appDataPath, "open-whispr")
    );
  }

  if (currentPath) {
    candidates.unshift(currentPath);
  }

  return Array.from(new Set(candidates.map((value) => path.resolve(value))));
}

function readEnvFile(profilePath) {
  const envPath = path.join(profilePath, ".env");
  if (!fs.existsSync(envPath)) {
    return "";
  }
  try {
    return fs.readFileSync(envPath, "utf8");
  } catch {
    return "";
  }
}

function getLocalStorageBytes(profilePath) {
  const storageDir = path.join(profilePath, "Local Storage");
  if (!fs.existsSync(storageDir)) {
    return 0;
  }

  let total = 0;
  const stack = [storageDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      try {
        total += fs.statSync(entryPath).size;
      } catch {
        // Ignore unreadable files.
      }
    }
  }

  return total;
}

function getFileSize(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getProfileStats(profilePath) {
  const envContent = readEnvFile(profilePath);
  const transcriptionsDbSize = Math.max(
    getFileSize(path.join(profilePath, "transcriptions.db")),
    getFileSize(path.join(profilePath, "transcriptions-dev.db"))
  );
  const localStorageBytes = getLocalStorageBytes(profilePath);
  const hasImportantEnvKey = IMPORTANT_ENV_KEYS.some((key) =>
    new RegExp(`(?:^|\\n)${key}=`).test(envContent)
  );
  const hasMigrationMarker = fs.existsSync(path.join(profilePath, PROFILE_MIGRATION_MARKER));
  const exists = fs.existsSync(profilePath);

  let score = 0;
  if (hasImportantEnvKey) {
    score += 100;
  }
  if (transcriptionsDbSize > 0) {
    score += Math.min(60, Math.floor(transcriptionsDbSize / 65536));
  }
  if (localStorageBytes > 0) {
    score += Math.min(30, Math.floor(localStorageBytes / 1024));
  }
  if (envContent.trim()) {
    score += 5;
  }

  return {
    path: profilePath,
    exists,
    envContent,
    hasImportantEnvKey,
    hasMigrationMarker,
    transcriptionsDbSize,
    localStorageBytes,
    score,
  };
}

function isEstablishedProfile(stats) {
  if (!stats?.exists) {
    return false;
  }
  return (
    stats.hasImportantEnvKey ||
    stats.transcriptionsDbSize >= ESTABLISHED_DB_BYTES ||
    stats.localStorageBytes >= ESTABLISHED_LOCAL_STORAGE_BYTES
  );
}

function selectMigrationSource(currentStats, candidateStats) {
  if (isEstablishedProfile(currentStats)) {
    return null;
  }

  const viableCandidates = candidateStats
    .filter((stats) => stats.path !== currentStats.path)
    .filter((stats) => stats.exists && stats.score > 0);

  viableCandidates.sort((left, right) => right.score - left.score);
  const best = viableCandidates[0] || null;

  if (!best) {
    return null;
  }

  if (!isEstablishedProfile(best)) {
    return null;
  }

  return best;
}

function copyProfileDirectory(sourcePath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });

  const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (VOLATILE_PROFILE_ENTRIES.has(entry.name)) {
      continue;
    }

    const sourceEntry = path.join(sourcePath, entry.name);
    const destinationEntry = path.join(destinationPath, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(sourceEntry, destinationEntry, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
      continue;
    }

    fs.copyFileSync(sourceEntry, destinationEntry);
  }
}

function migrateUserDataProfile({
  app,
  platform = process.platform,
  logger = console,
} = {}) {
  if (!app) {
    throw new Error("migrateUserDataProfile requires an Electron app instance");
  }

  const currentPath = app.getPath("userData");
  const appDataPath = app.getPath("appData");
  const candidatePaths = getCandidateUserDataPaths(appDataPath, platform, currentPath);

  const currentStats = getProfileStats(currentPath);
  const candidateStats = candidatePaths.map((candidatePath) => getProfileStats(candidatePath));
  const sourceStats = selectMigrationSource(currentStats, candidateStats);

  if (!sourceStats) {
    return {
      migrated: false,
      currentPath,
      sourcePath: null,
      reason: "no-migration-needed",
    };
  }

  copyProfileDirectory(sourceStats.path, currentPath);
  fs.writeFileSync(
    path.join(currentPath, PROFILE_MIGRATION_MARKER),
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        sourcePath: sourceStats.path,
      },
      null,
      2
    ),
    "utf8"
  );

  logger.log?.(
    `[ProfileMigration] migrated user data from ${sourceStats.path} to ${currentPath}`
  );

  return {
    migrated: true,
    currentPath,
    sourcePath: sourceStats.path,
    reason: "migrated",
  };
}

module.exports = {
  PROFILE_MIGRATION_MARKER,
  getCandidateUserDataPaths,
  getProfileStats,
  isEstablishedProfile,
  migrateUserDataProfile,
  selectMigrationSource,
};
