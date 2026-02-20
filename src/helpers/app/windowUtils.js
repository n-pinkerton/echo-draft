function isLiveWindow(window) {
  return Boolean(window && !window.isDestroyed?.());
}

module.exports = {
  isLiveWindow,
};

