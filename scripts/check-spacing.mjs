#!/usr/bin/env node
/**
 * The spacing checker.
 *
 * ── what it enforces ──────────────────────────────────────────────────────────
 *
 * A 4px grid, with one documented exception.
 *
 * Tailwind's spacing scale is a multiplier: `mt-3` is 3 x 0.25rem = 12px. So an
 * INTEGER step is always on the grid, and a FRACTIONAL step never is --
 * `py-1.5` is 6px, `py-2.5` is 10px, `py-3.5` is 14px. Those three are the
 * only offenders, and this script fails on them.
 *
 * `0.5` is 2px and is allowed: it is the tight step, for the padding inside a
 * badge or the gap between an icon and its label, where a 4px gap looks like a
 * mistake. It is the one exception and it is deliberate.
 *
 * ── why this is a script and not a style guide ────────────────────────────────
 *
 * Because a style guide is a document, and a document is not enforced. Every
 * component that adds a half step makes the next one's spacing look wrong by
 * comparison, so the drift is invisible from the inside and obvious from the
 * outside. This runs in `make check`, so a half step cannot reach a pull
 * request.
 *
 * Spacing that is not a Tailwind spacing utility -- `gap` on a grid template,
 * `padding` in a style attribute, a component's own `space-y-` in a `.css`
 * file -- is out of scope. This checks the class names.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] ?? 'apps/web/src';

/** Tailwind's spacing utilities. The group is what makes this a spacing check. */
const SPACING = [
  'p',
  'px',
  'py',
  'pt',
  'pb',
  'pl',
  'pr',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mb',
  'ml',
  'mr',
  'ms',
  'me',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'inset',
  'inset-x',
  'inset-y',
  'top',
  'right',
  'bottom',
  'left',
  'size',
  'w',
  'h',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'scroll-m',
  'scroll-mx',
  'scroll-my',
  'scroll-p',
  'scroll-px',
  'scroll-py',
];

/** Longest first, so `gap-x` is matched before `gap`. */
const GROUPS = SPACING.sort((a, b) => b.length - a.length)
  .map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * The pattern.
 *
 * The boundary matters: `px-3` must match, but `max-w-3xl` and `border-2` must
 * not, and neither must a class that merely ends in one of these names. So the
 * value is either a number (with an optional decimal) or an arbitrary value.
 */
const PATTERN = new RegExp(
  `(?:^|[\\s"'\`])((?:${GROUPS})-(?:\\d+(?:\\.\\d+)?|\\[[^\\]]*\\]))(?![\\w-])`,
  'g',
);

const ALLOWED_FRACTIONAL = new Set(['0.5']);

/** Files that are allowed to break the rule, with a reason. */
const EXEMPT = new Map([
  // The 44px tap target. It is a deliberate exception to the scale, not a
  // drift from it, and it is written as min-h-11 so it is visible as one.

  // The vendored chart components.
  //
  // `apps/web/src/components/charts/**` is Bklit's, installed with the shadcn
  // CLI and regenerated whenever the registry item is updated. The half-steps in
  // it are not drift -- they are how the library was written -- and they come
  // back with every install, so a rule that is permanently red on files nobody
  // edits stops being a signal and becomes noise.
  //
  // The components are covered by something better instead: the browser suite
  // visits the dashboard and asserts the charts mounted.
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    if (entry.endsWith('.test.tsx') || entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

const offenders = [];

for (const file of walk(ROOT)) {
  const rel = relative(process.cwd(), file);
  if (EXEMPT.has(rel)) continue;

  // The vendored chart components, wholesale.
  if (rel.includes('components/charts/')) continue;

  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    // A comment is not code. The design system is full of prose that mentions
    // class names, and a checker that reads its own documentation would be
    // useless.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!code.trim()) return;

    for (const match of code.matchAll(PATTERN)) {
      const utility = match[1];
      const value = utility.slice(utility.lastIndexOf('-') + 1);

      if (value.startsWith('[')) {
        // An arbitrary value. Only rem and px are on the grid; anything else is
        // a deliberate measurement and has to say so.
        const inner = value.slice(1, -1);
        const rem = inner.match(/^(-?[\d.]+)rem$/);
        if (rem) {
          const px = Number(rem[1]) * 16;
          if (Math.abs(px % 4) > 0.001) {
            offenders.push({ file: rel, line: index + 1, utility, why: `${rem[1]}rem is ${px}px` });
          }
        }
        continue;
      }

      if (!value.includes('.')) continue; // an integer step: always on the grid
      if (ALLOWED_FRACTIONAL.has(value)) continue;

      offenders.push({
        file: rel,
        line: index + 1,
        utility,
        why: `${value} is ${Number(value) * 4}px, which is not a multiple of 4`,
      });
    }
  });
}

if (offenders.length === 0) {
  console.log('every spacing value is on the 4px grid.');
  process.exit(0);
}

console.error(`\n${offenders.length} spacing value(s) off the 4px grid:\n`);
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}  ${o.utility}  — ${o.why}`);
}
console.error(
  '\nUse an integer step, or 0.5 for the tight step inside a badge or an icon gap.',
);
process.exit(1);
