const CACHE_TTL_MS = 30000;

// macOS accessibility: once granted, permissions persist across app sessions,
// so use a long TTL. Denied results re-check quickly so granting takes effect fast.
const ACCESSIBILITY_GRANTED_TTL_MS = 24 * 60 * 60 * 1000;
const ACCESSIBILITY_DENIED_TTL_MS = 5000;

// ms before simulating keystroke
const PASTE_DELAYS = {
  darwin: 120,
  win32_nircmd: 30,
  win32_pwsh: 40,
  linux: 50,
};

// ms after paste completes before restoring clipboard
const RESTORE_DELAYS = {
  darwin: 450,
  win32_nircmd: 850,
  win32_pwsh: 850,
  linux: 200,
};

module.exports = {
  CACHE_TTL_MS,
  ACCESSIBILITY_GRANTED_TTL_MS,
  ACCESSIBILITY_DENIED_TTL_MS,
  PASTE_DELAYS,
  RESTORE_DELAYS,
};

