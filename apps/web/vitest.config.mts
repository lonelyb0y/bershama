import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

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
    },
  },
});
