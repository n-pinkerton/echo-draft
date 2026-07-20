import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: { "@": path.resolve(__dirname, "src") },
        },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.{js,jsx,ts,tsx}"],
          exclude: [
            "src/utils/process.test.ts",
            "src/helpers/windowsHandleDelete.test.ts",
            "src/helpers/database.todo.integration.test.ts",
          ],
          setupFiles: ["src/test/setup.ts"],
        },
      },
      {
        resolve: {
          alias: { "@": path.resolve(__dirname, "src") },
        },
        test: {
          name: "node",
          environment: "node",
          include: [
            "scripts/**/*.test.{js,jsx,ts,tsx}",
            "src/utils/process.test.ts",
            "src/helpers/windowsHandleDelete.test.ts",
            "src/helpers/database.todo.integration.test.ts",
          ],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
