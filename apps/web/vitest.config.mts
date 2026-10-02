import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * `server-only` throws on import unless the `react-server` export condition is set,
 * which only the React Server Components runtime sets. A unit test runs in plain node
 * and gets the throw -- so the guard is aliased to an empty module here.
 *
 * That is safe precisely because it is the *build* that enforces the rule, not this
 * config. `pnpm build` resolves the real `server-only` and fails if a client
 * component reaches the module; vitest is not the thing that has to catch it, and
 * pretending otherwise here would take the guard away rather than test it.
 */
const serverOnlyStub = fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url));

export default defineConfig({
  test: {
    // node by default: most of the suite is pure logic -- the error mapper, the
    // API wrappers, the expiry bands -- and it should not pay for a DOM it never
    // touches. Component tests opt in per file with a
    // `@vitest-environment jsdom` docblock, so the cost is paid only there.
    environment: 'node',

    // BOTH extensions. A .ts-only include silently skipped the first component
    // test: 4 files, 66 tests, all green, with data.test.tsx sitting on disk
    // unrun. That is the worst outcome a test suite can have -- the file's
    // existence reads as coverage, and nothing reports that it never executed.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],

    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': serverOnlyStub,
    },
  },
});
