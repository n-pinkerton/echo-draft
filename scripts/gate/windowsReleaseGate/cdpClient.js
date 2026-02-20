const WebSocket = require("ws");

const { sleep } = require("./utils");

class CdpClient {
  constructor(wsUrl, { WebSocketImpl = WebSocket } = {}) {
    this.wsUrl = wsUrl;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new this.WebSocketImpl(this.wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
    });

    this.ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || "CDP error"));
        } else {
          resolve(message.result);
        }
      }
    });

    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    const text = JSON.stringify(payload);

    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(text, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });

    if (result?.exceptionDetails) {
      const description =
        result.exceptionDetails?.exception?.description ||
        result.exceptionDetails?.text ||
        "CDP evaluation exception";
      throw new Error(description);
    }

    return result?.result?.value;
  }

  async waitFor(predicateExpression, timeoutMs = 10000, intervalMs = 150) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const value = await this.eval(`Boolean(${predicateExpression})`);
        if (value) return true;
      } catch {
        // ignore and retry
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for: ${predicateExpression}`);
  }

  async waitForSelector(selector, timeoutMs = 10000) {
    const escaped = JSON.stringify(selector);
    return await this.waitFor(`document.querySelector(${escaped})`, timeoutMs);
  }

  async click(selector) {
    const escaped = JSON.stringify(selector);
    await this.eval(`
      (function () {
        const el = document.querySelector(${escaped});
        if (!el) throw new Error("Element not found: " + ${escaped});
        el.click();
        return true;
      })()
    `);
  }

  async setInputValue(selector, value) {
    const escapedSel = JSON.stringify(selector);
    const escapedVal = JSON.stringify(value);
    await this.eval(`
      (function () {
        const el = document.querySelector(${escapedSel});
        if (!el) throw new Error("Element not found: " + ${escapedSel});
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const protoDesc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
        if (protoDesc && typeof protoDesc.set === "function") {
          protoDesc.set.call(el, ${escapedVal});
        } else {
          el.value = ${escapedVal};
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
  }

  async close() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    await new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve();
      };

      ws.once("close", finish);

      timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        finish();
      }, 2000);

      try {
        ws.close();
      } catch {
        finish();
      }
    });
  }
}

module.exports = {
  CdpClient,
};

