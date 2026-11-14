import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "tests/e2e/.report/**", "tests/e2e/.results/**"]),
  {
    // The playback state machine predates the React Compiler lint rules; they are advisory here, not errors.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
  { files: ["tests/**"], rules: { "@typescript-eslint/no-explicit-any": "off", "react-hooks/rules-of-hooks": "off" } },
]);
