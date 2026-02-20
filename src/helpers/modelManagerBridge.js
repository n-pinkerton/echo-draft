const { ModelManager } = require("./modelManagerBridge/ModelManager");
const { ModelError, ModelNotFoundError } = require("./modelManagerBridge/errors");

module.exports = {
  default: new ModelManager(),
  ModelError,
  ModelNotFoundError,
};

