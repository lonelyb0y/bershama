# Recovery — resolved 2026-10-17

**Status: recovered from `github.com/lonelyb0y/bershama`. Working tree clean at
`74be355` ("M5 complete: cold chain readings (#75)"), tracking `origin/main`.**

## Verification

| Gate | Command | Result |
|---|---|---|
| Build | `pnpm build` | **pass** (exit 0) |
| Types | `pnpm typecheck` | **pass** (exit 0) |
| Lint | `pnpm lint` | **pass** (exit 0) |
| Tests | `pnpm test` | **pass** — 257 tests, 17 files |
| Working tree | `git status` | clean |

## What happened

The working tree was lost (disk filled; `node_modules` could not be copied back).
The first approach was to rebuild the source by replaying the OpenCode session
history in `opencode.db` — 4,136 tool operations reconstructed the tree, taking
`tsc` from 182 errors down to 103.

That was abandoned once the remote turned out to be reachable. It was both
better and unnecessary:

- The **replay was behind**. The session ran 2026-09-26 → 10-03; `origin/main`
  was at 2026-10-09 — six days *newer*. The clone had 20 files the replay never
  produced (Google Maps components, drug-register route, live position reporter,
  M5 snapshots and cold chain), and 58 more that differed.
- The **replay invented things**. It had generated `database.types.ts` by parsing
  migrations, hand-written `cn.ts`, and re-derived a `theme-script.ts` that had
  been deliberately deleted upstream in `b1341e5`. Every one of those was wrong.
- `pnpm-lockfile` and `.env.local` are gitignored, so neither came with the clone.

## How it was resolved

```bash
gh auth login -h github.com -p https -w -s repo   # private repo
gh repo clone lonelyb0y/bershama
pnpm install --frozen-lockfile
```

Two gotchas worth remembering:

1. **`gh` was not on the path git expected.** `~/.gitconfig` pinned the helper to
   `/usr/bin/gh`, but the binary is at `~/.local/bin/gh`, so every fetch failed
   with `could not read Username for 'https://github.com'`. Fixed:
   ```bash
   git config --global credential.helper \
     '!/home/taha/.local/bin/gh auth git-credential'
   ```
2. **Device-flow auth can half-complete.** The browser showed "Congratulations,
   you're all set" while the terminal never received a token, leaving
   `hosts.yml` unchanged. `--with-token` avoids the hang entirely.

## Deliberately not committed

`recovery/` (the replayer and the migration-based type generator) is **not** part
of the tree. It is a reconstruction tool, not project code, and it encodes
guesses — chiefly `database.types.ts`, which disagreed with the real schema in
enough ways to account for ~99 of the 182 errors. The upstream generated file is
present and authoritative. A copy is kept at
`~/.cache/replay-scratch/keep/` for reference.

If `recovery/` is wanted for provenance, it should be re-added deliberately with
a README stating that it is a reconstruction and that `origin/main` wins on any
conflict.

## Still outstanding

- `.env.local` is the placeholder template, not real credentials. The Supabase
  project it points at rejects it (401). A working local run needs real keys.
- `pnpm exec supabase gen types typescript --project-id kswdttkwtqqlabcjsgcy`
  needs a `SUPABASE_ACCESS_TOKEN`; the committed `database.types.ts` came from the
  clone, so no regeneration is required now.