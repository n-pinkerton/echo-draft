const http = require("http");
const net = require("net");

async function fetchJson(url, timeoutMs = 2000, { httpModule = http } = {}) {
  return await new Promise((resolve, reject) => {
    const request = httpModule.get(url, { timeout: timeoutMs }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });
  });
}

async function getFreeLoopbackPort({ netModule = net } = {}) {
  return await new Promise((resolve, reject) => {
    const server = netModule.createServer();
    server.unref?.();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!Number.isInteger(port) || port <= 0) {
          reject(new Error("Could not reserve a loopback port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

module.exports = {
  fetchJson,
  getFreeLoopbackPort,
};
