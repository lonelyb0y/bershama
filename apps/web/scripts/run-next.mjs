// Run the Next.js CLI with the repository-root .env.local loaded.
//
// ── why this exists ──────────────────────────────────────────────────────────
//
// The app tells you to put .env.local at the REPOSITORY ROOT. That is the right
// place -- one file, shared by the CLI, the checks and the app -- but Next.js
// only loads .env files from the directory it runs in, which is apps/web. So the
// documented instruction did not work, and the app failed with
//
//     Missing environment variable NEXT_PUBLIC_SUPABASE_URL
//
// for someone who had followed the instructions exactly. A symlink does not help
// either: Next's loader does not follow one.
//
// Rather than duplicate the file (two copies to drift) or weaken the error
// message to point somewhere less sensible, the root file is loaded into the
// environment before Next starts. Node's built-in loadEnvFile, so no dependency.
//
// `process.loadEnvFile` does not overwrite variables already in the environment,
// so a real deployment variable still wins over the file -- which is what makes
// this safe to ship rather than a dev-only hack.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

// A path, not a URL. `loadEnvFile` takes a filesystem path and is given a URL
// object here it fails to read the file -- silently, so the app then reports a
// missing environment variable when the file is right there and full of them.
const rootEnv = fileURLToPath(new URL('../../../.env.local', import.meta.url));

if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
} else {
  console.warn(
    '\n  No .env.local at the repository root.\n' +
      '  Copy .env.example to .env.local and fill it in.\n',
  );
}

// Hand the remaining arguments to Next's CLI unchanged, so `dev`, `build` and
// `start` all work exactly as before.
process.argv = [process.argv[0], 'next', ...process.argv.slice(2)];
await import('next/dist/bin/next');
