import { useLocalStorage } from "../useLocalStorage";

export function useMicrophoneSettings() {
  const [preferBuiltInMic, setPreferBuiltInMic] = useLocalStorage("preferBuiltInMic", true, {
    serialize: String,
    deserialize: (value) => value !== "false",
  });

  const [selectedMicDeviceId, setSelectedMicDeviceId] = useLocalStorage("selectedMicDeviceId", "", {
    serialize: String,
    deserialize: (value) => (value === "default" || value === "communications" ? "" : value),
  });

  return {
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
  };
}
