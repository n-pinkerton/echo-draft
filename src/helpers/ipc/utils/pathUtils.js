const path = require("path");

function isPathWithin(parentDir, childPath) {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

module.exports = { isPathWithin };

