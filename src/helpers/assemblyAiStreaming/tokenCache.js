const { TOKEN_EXPIRY_MS, TOKEN_REFRESH_BUFFER_MS } = require("./constants");

function isTokenValid(cachedToken, tokenFetchedAt, now = Date.now()) {
  if (!cachedToken || !tokenFetchedAt) return false;
  const age = now - tokenFetchedAt;
  return age < TOKEN_EXPIRY_MS - TOKEN_REFRESH_BUFFER_MS;
}

function getCachedToken(cachedToken, tokenFetchedAt, now = Date.now()) {
  return isTokenValid(cachedToken, tokenFetchedAt, now) ? cachedToken : null;
}

module.exports = { getCachedToken, isTokenValid };

