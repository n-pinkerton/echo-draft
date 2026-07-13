const getPlatform = () =>
  (
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    ""
  ).toLowerCase();

export const getMicrophoneLabelPermissionGuidance = () => {
  const platform = getPlatform();
  if (platform.includes("mac")) {
    return "macOS is hiding microphone names until access is allowed in System Settings > Privacy & Security > Microphone.";
  }
  if (platform.includes("win")) {
    return "Windows is hiding microphone names until access is allowed in Settings > Privacy & security > Microphone.";
  }
  return "Your system is hiding microphone names until microphone access is allowed.";
};

export const getMicrophonePermissionDeniedMessage = () => {
  const platform = getPlatform();
  if (platform.includes("mac")) {
    return "Microphone access was denied. Allow access in System Settings > Privacy & Security > Microphone, then try again.";
  }
  if (platform.includes("win")) {
    return "Microphone access was denied. Allow access in Settings > Privacy & security > Microphone, then try again.";
  }
  return "Microphone access was denied. Allow microphone access in your system settings, then try again.";
};
