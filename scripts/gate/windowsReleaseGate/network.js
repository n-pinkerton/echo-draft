const http = require("http");

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

module.exports = {
  fetchJson,
};

