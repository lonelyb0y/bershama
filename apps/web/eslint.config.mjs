import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /*
     * ── the vendored chart components ──────────────────────────────────────────
     *
     * `src/components/charts/**` is Bklit's, installed with the shadcn CLI and
     * regenerated whenever the registry item is updated. It is not our code, and
     * it is written against React 18's rules -- so React 19's compiler lint
     * reports fifty-five errors in it, all of them about reading a ref during
     * render and setting state inside an effect.
     *
     * Those are real patterns, and in OUR code they would be real bugs. In
     * vendored code they are how the library was written and tested, and the
     * alternative is maintaining a fork of a registry item: every update would
     * reintroduce them, and the fixes would be lost on the next install.
     *
     * So the rules are switched off for that directory, and the components are
     * covered by something better than a lint rule instead: the browser suite
     * visits the dashboard and asserts that the charts actually mounted. A
     * broken chart is a blank panel, and the test sees a blank panel.
     *
     * `no-explicit-any` is switched off with them, for the same reason: the
     * `any`s are in the library's own internals, they come back with every
     * registry update, and a rule that is permanently red on files nobody
     * edits stops being a signal and becomes noise.
     */
    files: ["src/components/charts/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    /*
     * The generated charts directory is vendored, so the same applies to the
     * one file the CLI places outside it.
     */
    files: ["src/components/shimmering-text.tsx"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
