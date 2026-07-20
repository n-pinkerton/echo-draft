import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import policy from "../eslint/policy-rules.cjs";

export default [
  { ignores: ["dist"] },
  // JS and JSX files (renderer - ES modules)
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_|^event|^err|^error" },
      ],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      "no-useless-catch": "off",
      "no-useless-escape": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react-hooks/rules-of-hooks": "warn",
      ...policy.baselineCorrectnessWarnings,
      ...policy.maintainabilityWarnings,
    },
  },
  // TypeScript files
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react-hooks/rules-of-hooks": "warn",
      ...policy.baselineCorrectnessWarnings,
      ...policy.maintainabilityWarnings,
    },
  },
  {
    files: [
      "App.{js,jsx}",
      "main.{js,jsx}",
      "bootstrap/**/*.{js,jsx,ts,tsx}",
      "components/**/*.{js,jsx,ts,tsx}",
      "hooks/**/*.{js,jsx,ts,tsx}",
      "stores/**/*.{js,jsx,ts,tsx}",
      "lib/**/*.{js,jsx,ts,tsx}",
      "services/**/*.{js,jsx,ts,tsx}",
      "utils/**/*.{js,jsx,ts,tsx}",
      "config/**/*.{js,jsx,ts,tsx}",
      "models/**/*.{js,jsx,ts,tsx}",
      "helpers/audioManager.{js,jsx,ts,tsx}",
      "helpers/audio/**/*.{js,jsx,ts,tsx}",
    ],
    ignores: [
      "**/*.test.*",
      "services/localReasoningBridge.js",
      "services/LocalReasoningService.ts",
      "utils/process.js",
      "utils/serverUtils.js",
      "config/updateTrust.js",
      "config/iconPaths.cjs",
      "config/rendererExternalModules.cjs",
      "config/InferenceConfig.ts",
    ],
    plugins: { "echodraft-policy": policy.plugins },
    rules: {
      "echodraft-policy/renderer-boundary": "error",
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "Renderer code must use the preload IPC boundary." },
        { name: "process", message: "Renderer code must use the preload IPC boundary." },
        { name: "require", message: "Renderer code must use the preload IPC boundary." },
      ],
    },
  },
];
