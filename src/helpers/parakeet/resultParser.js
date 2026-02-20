function parseParakeetResult(output) {
  if (!output || !output.text) {
    return { success: false, message: "No audio detected" };
  }

  const text = String(output.text).trim();
  if (!text) {
    return { success: false, message: "No audio detected" };
  }

  return { success: true, text };
}

module.exports = { parseParakeetResult };

