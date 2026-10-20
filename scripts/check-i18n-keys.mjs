/**
 * Find translation keys that are asked for and do not exist.
 *
 * A missing key does not fail a build. next-intl logs it, the page renders the key
 * itself, and the app carries on -- so "MISSING_MESSAGE: inventory.batch" as a column
 * header ships to production without a single test turning red.
 *
 * The association matters: a file often has several translators (`const t = useTranslations('a')`
 * and `const tNav = useTranslations('nav')`), so a key is checked against the namespace
 * of ITS OWN translator and not against every namespace the file happens to import.
 *
 * Run: node scripts/check-i18n-keys.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'apps/web/src';
const MESSAGES = 'apps/web/src/i18n/messages/en.json';

const messages = JSON.parse(readFileSync(MESSAGES, 'utf8'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(p)) out.push(p);
  }
  return out;
}

// const <name> = useTranslations('ns')  /  getTranslations('ns')
const BINDING = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"`]([a-zA-Z0-9_.]+)['"`]\s*\)/g;

const problems = [];

/**
 * A namespace can be a path: `useTranslations('deliveries.driver')` addresses a
 * nested bag, and next-intl resolves it as one. So the lookup walks the path rather
 * than indexing the top level with a dot in it.
 */
function resolve(bag, path) {
  let node = bag;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');

  // translator variable -> namespace
  const binding = new Map();
  for (const m of src.matchAll(BINDING)) binding.set(m[1], m[2]);
  if (!binding.size) continue;

  // <name>('key')
  const CALL = /\b([A-Za-z_$][\w$]*)\(\s*['"`]([a-zA-Z0-9_.]+)['"`]\s*[,)]/g;
  for (const m of src.matchAll(CALL)) {
    const [, varName, key] = m;
    const ns = binding.get(varName);
    if (!ns) continue; // not a translator: some other function
    if (key.includes('.')) continue; // nested path, resolved against the same bag

    const bag = resolve(messages, ns);
    if (!bag) {
      problems.push({ file: relative('.', file), ns, key, why: `namespace "${ns}" does not exist` });
      continue;
    }
    if (typeof bag !== 'object') continue;
    if (!(key in bag)) {
      problems.push({ file: relative('.', file), ns, key, why: `key "${key}" is missing` });
    }
  }
}

const seen = new Map();
for (const p of problems) {
  const key = `${p.ns}.${p.key}`;
  if (!seen.has(key)) seen.set(key, { ...p, count: 0 });
  seen.get(key).count++;
}

const list = [...seen.values()].sort((a, b) => a.ns.localeCompare(b.ns) || a.key.localeCompare(b.key));

if (!list.length) {
  console.log('every translation key asked for exists.');
  process.exit(0);
}

console.log(`${list.length} missing translation key(s):\n`);
for (const p of list) {
  console.log(`  ${p.ns}.${p.key}`);
  console.log(`    ${p.why}`);
  console.log(`    first used in ${p.file}${p.count > 1 ? ` (+${p.count - 1} more places)` : ''}`);
}
process.exit(1);
