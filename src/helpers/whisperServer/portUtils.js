const net = require("net");

const PORT_RANGE_START = 8178;
const PORT_RANGE_END = 8199;

const isPortAvailable = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
};

const findAvailablePort = async ({ start = PORT_RANGE_START, end = PORT_RANGE_END } = {}) => {
  for (let port = start; port <= end; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available ports in range ${start}-${end}`);
};

module.exports = {
  PORT_RANGE_END,
  PORT_RANGE_START,
  findAvailablePort,
  isPortAvailable,
};

