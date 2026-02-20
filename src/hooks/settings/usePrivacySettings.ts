import { useLocalStorage } from "../useLocalStorage";

export function usePrivacySettings() {
  const [cloudBackupEnabled, setCloudBackupEnabled] = useLocalStorage("cloudBackupEnabled", false, {
    serialize: String,
    deserialize: (value) => value === "true",
  });

  const [telemetryEnabled, setTelemetryEnabled] = useLocalStorage("telemetryEnabled", false, {
    serialize: String,
    deserialize: (value) => value === "true",
  });

  return {
    cloudBackupEnabled,
    setCloudBackupEnabled,
    telemetryEnabled,
    setTelemetryEnabled,
  };
}

