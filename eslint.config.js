import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Backend layering: controllers (HTTP) -> services (rules) -> repositories (SQL).
// Only src/database/** may build queries; controllers may not reach the data layer at all.
const SQL_ONLY_IN_REPOSITORIES = {
  group: ["drizzle-orm", "drizzle-orm/*", "**/database/rpc.js", "**/database/json.js", "**/database/client.js", "**/database/schema/**", "**/database/schema/index.js"],
  message: "Database queries belong in a repository (medris-backend/src/database/repositories); call it from a service.",
};
const CONTROLLERS_CALL_SERVICES = {
  group: ["**/database/repositories/**", "**/database/index.js", "**/database/context.js"],
  allowTypeImports: true,
  message: "Controllers stay thin: read the request, call a service, return its result. Data access goes through services.",
};

export default tseslint.config(
  {
    // The legacy runtime is classic browser scripts shared through globals; it is
    // guarded by `npm run legacy:check -w medris-frontend` (syntax) and the
    // byte-for-byte baseline test rather than by lint rules.
    ignores: ["**/dist/**", "**/node_modules/**", "medris-frontend/src/legacy/**", "medris-frontend/src/service-worker/**", "medris-frontend/public/**", "supabase/**", "docs/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["medris-backend/**/*.ts", "medris-frontend/build/**/*.ts", "medris-frontend/scripts/**/*.ts", "medris-frontend/*.config.ts", "api/**/*.js", "scripts/**/*.mjs", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["medris-frontend/src/**/*.{ts,tsx}", "medris-frontend/tests/**/*.ts"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["medris-backend/src/**/*.ts"],
    ignores: ["medris-backend/src/database/**"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [SQL_ONLY_IN_REPOSITORIES] }] },
  },
  {
    files: ["medris-backend/src/**/*.controller.ts", "medris-backend/src/routes/**/*.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [SQL_ONLY_IN_REPOSITORIES, CONTROLLERS_CALL_SERVICES] }] },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
