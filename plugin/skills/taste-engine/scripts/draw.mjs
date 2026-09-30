#!/usr/bin/env node
// Seeded, ledger-aware constraint-deck draw. Deterministic for a given slug + salts.
// Usage: node draw.mjs --slug <slug> [--reroll axisA,axisB] [--window 12] [--deck <path>] [--ledger <path>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const slug = opt('slug');
if (!slug) {
  console.error('usage: draw.mjs --slug <product-slug> [--reroll axis,axis] [--window 12]');
  process.exit(2);
}
const window = Number(opt('window', '12'));
const deckPath = opt('deck', path.join(here, '..', 'references', 'constraint-deck.json'));
const home = process.env.SEDEF_HOME ?? path.join(process.env.HOME ?? '', 'sedef');
const ledgerPath = opt('ledger', path.join(home, 'factory', 'ledger', 'novelty.jsonl'));
const rerolls = new Set((opt('reroll', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// FNV-1a 32-bit
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
let ledger = [];
if (fs.existsSync(ledgerPath)) {
  ledger = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}
const recent = ledger.filter((f) => f.product !== slug).slice(-window);

const draw = {};
const excluded = {};
for (const [axis, values] of Object.entries(deck.axes)) {
  const used = new Set(recent.map((f) => (f.direction ?? {})[axis]).filter(Boolean));
  excluded[axis] = [...used];
  let pool = values.filter((v) => !used.has(v.id));
  if (pool.length === 0) pool = values;
  const salt = rerolls.has(axis) ? 1 : 0;
  const pick = pool[hash(`${slug}:${axis}:${salt}`) % pool.length];
  draw[axis] = pick.hint ? { id: pick.id, hint: pick.hint } : { id: pick.id };
}

const dial = (name) => 3 + (hash(`${slug}:dial:${name}`) % 6); // 3..8
const out = {
  slug,
  compared_with: recent.map((f) => f.product),
  draw: Object.fromEntries(Object.entries(draw).map(([k, v]) => [k, v.id])),
  hints: Object.fromEntries(Object.entries(draw).filter(([, v]) => v.hint).map(([k, v]) => [k, v.hint])),
  dials: { design_variance: dial('variance'), motion_intensity: dial('motion'), visual_density: dial('density') },
  excluded,
  rerolled: [...rerolls],
};
console.log(JSON.stringify(out, null, 2));
