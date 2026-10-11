import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

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
    files: ["medris-backend/**/*.ts", "medris-frontend/build/**/*.ts", "medris-frontend/scripts/**/*.ts", "medris-frontend/*.config.ts", "api/**/*.js", "*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["medris-frontend/src/**/*.{ts,tsx}", "medris-frontend/tests/**/*.ts"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
