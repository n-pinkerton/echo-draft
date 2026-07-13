const fs = require("fs");
const path = require("path");

const { sleep } = require("../utils");

async function captureControlPanelUi(panel, outputDir, runId) {
  await panel.waitForSelector('[data-testid="history-search"]', 15000);
  await panel.eval(`window.scrollTo({ top: 0, behavior: "instant" }); true;`);
  await sleep(300);

  const screenshot = await panel.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (!screenshot?.data) {
    throw new Error("CDP did not return packaged control-panel screenshot data");
  }

  const screenshotDir = path.join(outputDir, "screenshots");
  const screenshotPath = path.join(screenshotDir, `control-panel-${runId}.png`);
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  return screenshotPath;
}

module.exports = { captureControlPanelUi };
