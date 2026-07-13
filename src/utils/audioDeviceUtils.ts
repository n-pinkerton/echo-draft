/**
 * Utility functions for audio device detection and management.
 * Shared between renderer components and audio manager.
 */

/**
 * Determines if a microphone device is a built-in device based on its label.
 * Works across macOS, Windows, and Linux platforms.
 */
export function isBuiltInMicrophone(label: string): boolean {
  const lowerLabel = label.toLowerCase();

  // Direct built-in indicators
  if (
    lowerLabel.includes("built-in") ||
    lowerLabel.includes("internal") ||
    lowerLabel.includes("macbook") ||
    lowerLabel.includes("integrated")
  ) {
    return true;
  }

  // Generic "microphone" without external device indicators
  if (lowerLabel.includes("microphone")) {
    const externalIndicators = [
      "bluetooth",
      "airpods",
      "wireless",
      "usb",
      "external",
      "headset",
      "webcam",
    ];
    return !externalIndicators.some((indicator) => lowerLabel.includes(indicator));
  }

  return false;
}

export type SelectableAudioInput = {
  deviceId: string;
  label: string;
  originalLabel: string;
  isBuiltIn: boolean;
};

export function normalizeAudioInputDevices(
  devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]
): SelectableAudioInput[] {
  const seenDeviceIds = new Set<string>();
  let unnamedDeviceIndex = 0;

  return devices.flatMap((device) => {
    const deviceId = device.deviceId.trim();
    if (
      device.kind !== "audioinput" ||
      !deviceId ||
      deviceId === "default" ||
      deviceId === "communications" ||
      seenDeviceIds.has(deviceId)
    ) {
      return [];
    }

    seenDeviceIds.add(deviceId);
    if (!device.label) unnamedDeviceIndex += 1;
    return [
      {
        deviceId,
        label: device.label || `Microphone ${unnamedDeviceIndex}`,
        originalLabel: device.label,
        isBuiltIn: isBuiltInMicrophone(device.label),
      },
    ];
  });
}
