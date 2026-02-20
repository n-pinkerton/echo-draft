function createAudioStats() {
  return {
    chunksReceived: 0,
    bytesReceived: 0,
    chunksSent: 0,
    bytesSent: 0,
    chunksDropped: 0,
    firstChunkAt: null,
    lastChunkAt: null,
    firstDropAt: null,
    lastDropAt: null,
    lastBufferedAmount: null,
    maxBufferedAmount: 0,
  };
}

function copyAudioStats(stats) {
  return stats ? { ...stats } : null;
}

function recordChunkReceived(stats, byteLength, now = Date.now()) {
  if (!stats) return;
  stats.chunksReceived += 1;
  stats.bytesReceived += byteLength;
  if (!stats.firstChunkAt) {
    stats.firstChunkAt = now;
  }
  stats.lastChunkAt = now;
}

function recordChunkDropped(stats, now = Date.now()) {
  if (!stats) return;
  stats.chunksDropped += 1;
  if (!stats.firstDropAt) {
    stats.firstDropAt = now;
  }
  stats.lastDropAt = now;
}

function recordChunkSent(stats, byteLength, bufferedAmount, now = Date.now()) {
  if (!stats) return;
  stats.chunksSent += 1;
  stats.bytesSent += byteLength;
  stats.lastChunkAt = now;
  stats.lastBufferedAmount = bufferedAmount;
  stats.maxBufferedAmount = Math.max(stats.maxBufferedAmount, bufferedAmount);
}

module.exports = {
  copyAudioStats,
  createAudioStats,
  recordChunkDropped,
  recordChunkReceived,
  recordChunkSent,
};

