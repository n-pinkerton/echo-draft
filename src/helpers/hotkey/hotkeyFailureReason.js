const { getSuggestions } = require("./hotkeySuggestions");

function getFailureReason(hotkey, { globalShortcut, platform = process.platform } = {}) {
  if (globalShortcut?.isRegistered?.(hotkey)) {
    return {
      reason: "already_registered",
      message: `"${hotkey}" is already registered by another application.`,
      suggestions: getSuggestions(hotkey, platform),
    };
  }

  if (platform === "linux") {
    // Linux DE's often reserve Super/Meta combinations
    if (String(hotkey || "").includes("Super") || String(hotkey || "").includes("Meta")) {
      return {
        reason: "os_reserved",
        message: `"${hotkey}" may be reserved by your desktop environment.`,
        suggestions: getSuggestions(hotkey, platform),
      };
    }
  }

  return {
    reason: "registration_failed",
    message: `Could not register "${hotkey}". It may be in use by another application.`,
    suggestions: getSuggestions(hotkey, platform),
  };
}

module.exports = {
  getFailureReason,
};

