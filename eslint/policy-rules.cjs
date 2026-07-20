const productionCorrectnessRules = {
  "no-duplicate-case": "error",
  "no-dupe-keys": "error",
  "no-unsafe-finally": "error",
  "no-unreachable-loop": "error",
  "no-promise-executor-return": "error",
  "no-async-promise-executor": "error",
  "no-return-await": "error",
  "require-yield": "error",
  "no-await-in-loop": "warn",
  "require-atomic-updates": "warn",
};
const { builtinModules } = require("node:module");

const maintainabilityWarnings = {
  complexity: ["warn", { max: 20 }],
  "max-depth": ["warn", { max: 4 }],
  "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": [
    "warn",
    { max: 120, skipBlankLines: true, skipComments: true },
  ],
};

const baselineCorrectnessWarnings = Object.fromEntries(
  Object.entries(productionCorrectnessRules).map(([rule]) => [rule, "warn"])
);

const rendererBoundaryRule = {
  meta: {
    type: "problem",
    docs: { description: "Keep renderer code behind the preload IPC boundary." },
    schema: [],
  },
  create(context) {
    const restricted = new Set(["electron", "electron-updater", ...builtinModules]);
    const restrictedLocalFragments = [
      "/helpers/ModelManager",
      "/helpers/modelManagerBridge",
      "/helpers/database",
      "/helpers/ipcHandlers",
      "/helpers/windowManager",
      "/helpers/llama",
      "/helpers/whisper",
      "/helpers/parakeet",
      "/helpers/clipboard",
      "/config/InferenceConfig",
      "/services/LocalReasoningService",
    ];
    const isRestricted = (value) =>
      restricted.has(value) ||
      value.startsWith("node:") ||
      ((value.startsWith(".") || value.startsWith("@/")) &&
        restrictedLocalFragments.some((fragment) => value.replaceAll("\\", "/").includes(fragment)));
    return {
      ImportDeclaration(node) {
        if (isRestricted(node.source.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
      ImportExpression(node) {
        const source = node.source;
        if (source?.type === "Literal" && typeof source.value === "string" && isRestricted(source.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === "Literal" && typeof node.source.value === "string" && isRestricted(node.source.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
      ExportAllDeclaration(node) {
        if (node.source?.type === "Literal" && typeof node.source.value === "string" && isRestricted(node.source.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const [argument] = node.arguments;
        if (argument?.type === "Literal" && typeof argument.value === "string" && isRestricted(argument.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
    };
  },
};

module.exports = {
  productionCorrectnessRules,
  baselineCorrectnessWarnings,
  maintainabilityWarnings,
  plugins: { rules: { "renderer-boundary": rendererBoundaryRule } },
};
