import fs from 'node:fs';
import path from 'node:path';
import type { Chore, ChoreAction, FactoryState } from './state.js';
import { nextId, slugify } from './state.js';
import { nowIso, readJson, writeJsonAtomic } from './util.js';

/** What an agent writes into <product>/.sedef/chores.json when a step needs a human. */
export interface ChoreInput {
  key: string;
  kind: string;
  title: string;
  instructions: string;
  minutes?: number;
  blocking?: boolean;
  options?: string[];
  actions?: Record<string, ChoreAction>;
}

/**
 * `.sedef/chores.json` is an outbox: after each session the foreman takes what the agent wrote,
 * empties the file and keeps a history, so a request is raised once — not again after every session.
 */
export function consumeProductChores(productDir: string): { inputs: ChoreInput[]; rejected: unknown[] } {
  const file = path.join(productDir, '.sedef', 'chores.json');
  if (!fs.existsSync(file)) return { inputs: [], rejected: [] };
  const { inputs, rejected } = parseProductChores(productDir);
  const historyFile = path.join(productDir, '.sedef', 'chores-history.json');
  const history = readJson<unknown[]>(historyFile, []);
  const at = nowIso();
  const rows = [...inputs.map((c) => ({ ...c, raised_at: at })), ...rejected.map((c) => ({ rejected: c, raised_at: at, reason: 'needs at least a "title"' }))];
  writeJsonAtomic(historyFile, [...(Array.isArray(history) ? history : []), ...rows].slice(-200));
  writeJsonAtomic(file, []);
  return { inputs, rejected };
}

/** The human's answers flow back to the product so the next session knows what was done or chosen. */
export function recordChoreAnswer(productDir: string, chore: Chore): void {
  const file = path.join(productDir, '.sedef', 'chore-answers.json');
  const answers = readJson<unknown[]>(file, []);
  const entry = { id: chore.id, key: chore.key, title: chore.title, ...(chore.choice ? { choice: chore.choice } : {}), done_at: chore.done_at };
  writeJsonAtomic(file, [...(Array.isArray(answers) ? answers : []), entry].slice(-200));
}

export function readProductChores(productDir: string): ChoreInput[] {
  return parseProductChores(productDir).inputs;
}

/** Lenient: a title is enough (key and instructions are derived); anything without one is reported, not silently dropped. */
export function parseProductChores(productDir: string): { inputs: ChoreInput[]; rejected: unknown[] } {
  const raw = readJson<unknown>(path.join(productDir, '.sedef', 'chores.json'), []);
  const list = Array.isArray(raw) ? raw : (raw as { chores?: unknown[] })?.chores ?? (raw && typeof raw === 'object' ? [raw] : []);
  const inputs: ChoreInput[] = [];
  const rejected: unknown[] = [];
  for (const c of list) {
    const o = (c ?? {}) as Partial<ChoreInput> & { description?: string };
    if (typeof o.title !== 'string' || !o.title.trim()) { rejected.push(c); continue; }
    const instructions = typeof o.instructions === 'string' && o.instructions.trim() ? o.instructions : (typeof o.description === 'string' ? o.description : o.title);
    inputs.push({ ...o, key: typeof o.key === 'string' && o.key.trim() ? o.key : `chore-${slugify(o.title, 6)}`, kind: o.kind || 'other', title: o.title, instructions });
  }
  return { inputs, rejected };
}

/** Insert a chore unless an open one with the same key exists. Returns the new chore. */
export function upsertChore(state: FactoryState, input: ChoreInput, product?: string): Chore | undefined {
  const exists = state.chores.find((c) => c.key === input.key && c.product === product && !c.done_at);
  if (exists) return undefined;
  const chore: Chore = {
    id: nextId(state, 'c'),
    key: input.key,
    ...(product ? { product } : {}),
    kind: input.kind,
    title: input.title,
    instructions: input.instructions,
    ...(input.minutes ? { minutes: input.minutes } : {}),
    blocking: input.blocking ?? false,
    ...(input.options?.length ? { options: input.options } : {}),
    ...(input.actions ? { actions: input.actions } : {}),
    created_at: nowIso(),
    notified: false,
  };
  state.chores.push(chore);
  return chore;
}

export function pendingChores(state: FactoryState, product?: string): Chore[] {
  return state.chores.filter((c) => !c.done_at && (product === undefined || c.product === product));
}

export function completeChore(state: FactoryState, id: string, choice?: string): Chore | undefined {
  const c = state.chores.find((x) => x.id === id && !x.done_at);
  if (!c) return undefined;
  if (c.options?.length && choice && !c.options.includes(choice)) return undefined;
  c.done_at = nowIso();
  if (choice) c.choice = choice;
  return c;
}

export function formatChore(c: Chore): string {
  const mins = c.minutes ? ` · ~${c.minutes} dk` : '';
  const who = c.product ? ` · ${c.product}` : '';
  const opts = c.options?.length ? `\nSeçenekler: ${c.options.map((o) => `/tamam ${c.id} ${o}`).join('  ')}` : `\nBitince: /tamam ${c.id}`;
  return `🔑 <b>${c.id}</b>${who}${mins}${c.blocking ? ' · ⛔ bekletiyor' : ''}\n${c.title}\n${c.instructions}${opts}`;
}
