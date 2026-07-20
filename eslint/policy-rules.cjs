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
const path = require("node:path");
const rendererExternalModules = require("../src/config/rendererExternalModules.cjs");

const srcRoot = path.resolve(__dirname, "../src");
const helpersRoot = path.join(srcRoot, "helpers");
const rendererMainOnlyModules = Object.freeze([
  "utils.js",
  "updater.js",
  "services/localReasoningBridge.js",
  "services/LocalReasoningService.ts",
  "utils/process.js",
  "utils/serverUtils.js",
  "config/updateTrust.js",
  "config/iconPaths.cjs",
  "config/rendererExternalModules.cjs",
  "config/InferenceConfig.ts",
]);
const mainOnlyModules = rendererMainOnlyModules.map((modulePath) => path.join(srcRoot, modulePath));
const normalizeComparablePath = (value) => path.resolve(value).replaceAll("\\", "/").toLowerCase();
const stripModuleExtension = (value) => value.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
const normalizedHelpersRoot = normalizeComparablePath(helpersRoot);
const normalizedMainOnlyModules = new Set(
  mainOnlyModules.flatMap((modulePath) => {
    const normalized = normalizeComparablePath(modulePath);
    return [normalized, stripModuleExtension(normalized)];
  })
);

const maintainabilityWarnings = {
  complexity: ["warn", { max: 20 }],
  "max-depth": ["warn", { max: 4 }],
  "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["warn", { max: 120, skipBlankLines: true, skipComments: true }],
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
    const maxStaticStringDepth = 12;
    const maxStaticStringLength = 256;
    const sourceCode = context.sourceCode;
    const references = new Map(
      sourceCode.scopeManager.scopes.flatMap((scope) =>
        scope.references.map((reference) => [reference.identifier, reference])
      )
    );
    const variablesByIdentifier = new Map(
      sourceCode.scopeManager.scopes.flatMap((scope) =>
        scope.variables.flatMap((variable) =>
          variable.identifiers.map((identifier) => [identifier, variable])
        )
      )
    );
    const restricted = new Set([...rendererExternalModules, "electron-updater", ...builtinModules]);
    const rendererSafeHelpers = [
      /^audioManager(?:\.(?:[cm]?[jt]sx?))?$/i,
      /^audio(?:\/|$)/i,
      /^mobileInboxContract\.cjs$/i,
    ];
    const isRestrictedExternal = (value) =>
      value.startsWith("node:") ||
      [...restricted].some(
        (moduleName) => value === moduleName || value.startsWith(`${moduleName}/`)
      );
    const resolveLocalImport = (value) => {
      if (value.startsWith("@/")) return path.resolve(srcRoot, value.slice(2));
      if (!value.startsWith(".")) return null;
      return path.resolve(path.dirname(context.filename), value);
    };
    const isRestrictedHelper = (value) => {
      const resolved = resolveLocalImport(value);
      if (!resolved) return false;
      const normalized = normalizeComparablePath(resolved);
      if (
        normalized !== normalizedHelpersRoot &&
        !normalized.startsWith(`${normalizedHelpersRoot}/`)
      ) {
        return false;
      }
      const relativeHelperPath = normalized.slice(normalizedHelpersRoot.length + 1);
      return !rendererSafeHelpers.some((pattern) => pattern.test(relativeHelperPath));
    };
    const isRestrictedMainOnlyModule = (value) => {
      const resolved = resolveLocalImport(value);
      if (!resolved) return false;
      const normalized = normalizeComparablePath(resolved);
      return (
        normalizedMainOnlyModules.has(normalized) ||
        normalizedMainOnlyModules.has(stripModuleExtension(normalized))
      );
    };
    const isRestricted = (value) => {
      return (
        isRestrictedExternal(value) ||
        isRestrictedHelper(value) ||
        isRestrictedMainOnlyModule(value)
      );
    };
    const report = (node) => {
      context.report({ node, message: "Renderer code must use the preload IPC boundary." });
    };
    const isAmbientDefinition = (definition) => {
      let node = definition.node;
      while (node != null && node.type !== "Program") {
        if (node.type === "TSDeclareFunction" || node.declare === true) return true;
        node = node.parent;
      }
      return false;
    };
    const isTypeOnlyReference = (reference) => {
      if (reference == null) return false;
      if (reference.isTypeReference === true && reference.isValueReference === false) return true;
      let node = reference.identifier;
      while (node?.parent != null) {
        if (node.parent.type === "TSTypeQuery") return true;
        if (
          ["TSAsExpression", "TSTypeAssertion"].includes(node.parent.type) &&
          node.parent.expression === node
        ) {
          return false;
        }
        node = node.parent;
      }
      return false;
    };
    const isGlobalReference = (node) => {
      const reference = references.get(node);
      return (
        reference != null &&
        !isTypeOnlyReference(reference) &&
        (reference.resolved == null ||
          reference.resolved.defs.length === 0 ||
          reference.resolved.defs.every(isAmbientDefinition))
      );
    };
    const isCanonicalRequireCall = (node) => {
      const call = node.parent;
      if (
        call?.type !== "CallExpression" ||
        call.callee !== node ||
        call.optional ||
        call.arguments.length !== 1
      ) {
        return false;
      }
      const [argument] = call.arguments;
      return (
        argument.type === "Literal" &&
        typeof argument.value === "string" &&
        !isRestricted(argument.value)
      );
    };
    const staticStringValue = (node, seen = new Set(), depth = 0) => {
      if (depth > maxStaticStringDepth) return null;
      const withinBudget = (value) =>
        typeof value === "string" && value.length <= maxStaticStringLength ? value : null;
      if (node?.type === "Literal" && typeof node.value === "string") {
        return withinBudget(node.value);
      }
      if (node?.type === "TemplateLiteral") {
        let value = node.quasis[0].value.cooked;
        if (value == null) return null;
        for (const [index, expression] of node.expressions.entries()) {
          const expressionValue = staticStringValue(expression, seen, depth + 1);
          const following = node.quasis[index + 1].value.cooked;
          if (typeof expressionValue !== "string" || following == null) return null;
          value += expressionValue + following;
          if (value.length > maxStaticStringLength) return null;
        }
        return withinBudget(value);
      }
      if (node?.type === "BinaryExpression" && node.operator === "+") {
        const left = staticStringValue(node.left, seen, depth + 1);
        const right = staticStringValue(node.right, seen, depth + 1);
        return typeof left === "string" && typeof right === "string"
          ? withinBudget(left + right)
          : null;
      }
      if (["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression"].includes(node?.type)) {
        return staticStringValue(node.expression, seen, depth + 1);
      }
      if (node?.type !== "Identifier") return null;
      const variable = references.get(node)?.resolved;
      if (variable == null || seen.has(variable) || variable.defs.length !== 1) return null;
      const [definition] = variable.defs;
      if (
        definition.type !== "Variable" ||
        definition.parent?.kind !== "const" ||
        definition.node.id.type !== "Identifier" ||
        definition.node.init == null
      ) {
        return null;
      }
      const nextSeen = new Set(seen);
      nextSeen.add(variable);
      return staticStringValue(definition.node.init, nextSeen, depth + 1);
    };
    const staticPropertyName = (node) => {
      const property = node.type === "Property" ? node.key : node.property;
      if (!node.computed && property.type === "Identifier") return property.name;
      if (node.computed) return staticStringValue(property);
      return null;
    };
    const globalLoaderContainers = new Set(["module", "globalThis", "global", "window", "self"]);
    const loaderBearingProperties = new Set(["require", "module", "process", "Buffer", "global"]);
    const isGlobalLoaderContainer = (node) =>
      node?.type === "Identifier" &&
      globalLoaderContainers.has(node.name) &&
      isGlobalReference(node);
    const unwrapTypeExpression = (node) => {
      let expression = node;
      while (
        ["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression"].includes(
          expression.parent?.type
        ) &&
        expression.parent.expression === expression
      ) {
        expression = expression.parent;
      }
      return expression;
    };
    const classifyMemberChain = (node, rootName) => {
      const properties = [];
      let expression = unwrapTypeExpression(node);
      while (
        expression.parent?.type === "MemberExpression" &&
        expression.parent.object === expression
      ) {
        const propertyName = staticPropertyName(expression.parent);
        if (propertyName == null) return "unproven";
        properties.push(propertyName);
        expression = unwrapTypeExpression(expression.parent);
      }
      if (properties.length === 0) return "none";
      if (rootName === "module") {
        return properties[0] === "exports" ? "safe" : "restricted";
      }
      return properties.some((propertyName) => loaderBearingProperties.has(propertyName))
        ? "restricted"
        : "safe";
    };
    const isSafeAliasRead = (node, rootName) => {
      const expression = unwrapTypeExpression(node);
      if (
        expression.parent?.type === "UnaryExpression" &&
        expression.parent.argument === expression &&
        ["!", "typeof"].includes(expression.parent.operator)
      ) {
        return true;
      }
      return classifyMemberChain(node, rootName) === "safe";
    };
    const isUndefinedIdentifier = (node) =>
      node?.type === "Identifier" && node.name === "undefined";
    const safeAliasVariable = (node) => {
      let expression = unwrapTypeExpression(node);
      if (
        expression.parent?.type === "ConditionalExpression" &&
        ((expression.parent.consequent === expression &&
          isUndefinedIdentifier(expression.parent.alternate)) ||
          (expression.parent.alternate === expression &&
            isUndefinedIdentifier(expression.parent.consequent)))
      ) {
        expression = expression.parent;
      }
      const owner = expression.parent;
      const identifier =
        owner?.type === "VariableDeclarator" && owner.init === expression
          ? owner.id
          : owner?.type === "AssignmentPattern" && owner.right === expression
            ? owner.left
            : null;
      if (identifier?.type !== "Identifier") return null;
      const variable = variablesByIdentifier.get(identifier);
      const reads =
        variable?.references.filter(
          (reference) => reference.isRead() && !isTypeOnlyReference(reference)
        ) ?? [];
      return reads.length > 0 &&
        reads.every((reference) => isSafeAliasRead(reference.identifier, node.name))
        ? variable
        : null;
    };
    const isAllowedGlobalContainerUse = (node) => {
      if (
        node.name !== "module" &&
        node.parent?.type === "UnaryExpression" &&
        node.parent.operator === "typeof"
      ) {
        return true;
      }
      if (classifyMemberChain(node, node.name) === "safe") return true;
      return node.name !== "module" && safeAliasVariable(node) !== null;
    };
    return {
      ImportDeclaration(node) {
        if (isRestricted(node.source.value)) {
          context.report({ node, message: "Renderer code must use the preload IPC boundary." });
        }
      },
      ImportExpression(node) {
        const source = node.source;
        if (
          source?.type !== "Literal" ||
          typeof source.value !== "string" ||
          isRestricted(source.value)
        ) {
          report(node);
        }
      },
      ExportNamedDeclaration(node) {
        if (
          node.source?.type === "Literal" &&
          typeof node.source.value === "string" &&
          isRestricted(node.source.value)
        ) {
          report(node);
        }
      },
      ExportAllDeclaration(node) {
        if (
          node.source?.type === "Literal" &&
          typeof node.source.value === "string" &&
          isRestricted(node.source.value)
        ) {
          report(node);
        }
      },
      Identifier(node) {
        if (node.name === "require" && isGlobalReference(node) && !isCanonicalRequireCall(node)) {
          report(node);
        }
        if (isGlobalLoaderContainer(node) && !isAllowedGlobalContainerUse(node)) {
          report(node);
        }
      },
      TSImportEqualsDeclaration(node) {
        const reference = node.moduleReference;
        if (reference.type !== "TSExternalModuleReference") return;
        const source = reference.expression;
        if (
          source.type !== "Literal" ||
          typeof source.value !== "string" ||
          isRestricted(source.value)
        ) {
          report(node);
        }
      },
    };
  },
};

module.exports = {
  productionCorrectnessRules,
  baselineCorrectnessWarnings,
  maintainabilityWarnings,
  rendererMainOnlyModules,
  plugins: { rules: { "renderer-boundary": rendererBoundaryRule } },
};
