import fs from 'node:fs';
import { ensureDir, nowIso, readJson, writeJsonAtomic } from './util.js';
import path from 'node:path';

export type ProductStatus = 'ready' | 'running' | 'waiting' | 'blocked' | 'failed' | 'done';

export interface ProductEvent {
  at: string;
  stage: string;
  event: string;
  note?: string;
}

export interface Product {
  slug: string;
  title: string;
  lane: string;
  idea_id: string;
  source: 'scout' | 'human';
  stage: string;
  status: ProductStatus;
  wait_until?: string;
  attempts: Record<string, number>;
  replans: number;
  created_at: string;
  updated_at: string;
  dir: string;
  spend_usd: number;
  submissions: number;
  approvals: string[]; // human approvals, e.g. "first_submission"
  app_ids: Record<string, string>;
  progress?: Record<string, number>; // last accepted value of a stage's progress field
  launched_at?: string;
  last_error?: string;
  /** Consecutive sessions lost to transient API/network errors (reset by any other outcome). */
  api_failures?: number;
  /** How often each stage was entered during the current release cycle (loop guard; cleared when a version ships). */
  visits?: Record<string, number>;
  /** Consecutive passes of the current stage that routed back to itself without a poll interval (backoff grows). */
  self_loops?: number;
  events: ProductEvent[];
}

export interface Idea {
  id: string;
  title: string;
  summary_tr: string;
  lane: string;
  score: number;
  card_path: string;
  source: 'scout' | 'human';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  decided_at?: string;
  telegram_message_id?: number;
  product?: string;
}

export interface ChoreAction {
  goto?: string;
  approve?: string; // adds to product.approvals
}

export interface Chore {
  id: string;
  key: string;
  product?: string;
  kind: string;
  title: string;
  instructions: string;
  minutes?: number;
  blocking: boolean;
  options?: string[];
  actions?: Record<string, ChoreAction>;
  created_at: string;
  done_at?: string;
  choice?: string;
  notified: boolean;
}

export interface Submission {
  at: string;
  product: string;
  store: string;
  kind: 'new' | 'update' | 'resubmission';
}

export interface FactoryState {
  version: 1;
  seq: number;
  paused: boolean;
  pause_reason?: string;
  products: Record<string, Product>;
  ideas: Record<string, Idea>;
  chores: Chore[];
  submissions: Submission[];
  schedule: {
    last_scout_date?: string;
    last_digest_date?: string;
    last_portfolio_date?: string;
    last_retro_date?: string;
    budget_alert_date?: string;
    last_digest_at?: string;
  };
  telegram: { offset: number };
  outbox: { text: string; at: string }[];
}

export function emptyState(): FactoryState {
  return {
    version: 1,
    seq: 0,
    paused: false,
    products: {},
    ideas: {},
    chores: [],
    submissions: [],
    schedule: {},
    telegram: { offset: 0 },
    outbox: [],
  };
}

export function loadState(file: string): FactoryState {
  const loaded = readJson<Partial<FactoryState>>(file, {});
  const base = emptyState();
  const state: FactoryState = { ...base, ...loaded, schedule: { ...base.schedule, ...loaded.schedule }, telegram: { ...base.telegram, ...loaded.telegram } };
  // Anything that was "running" when the process died (sleep, reboot, crash) is ready again,
  // and the interrupted attempt is not held against the product.
  for (const p of Object.values(state.products)) {
    if (p.status !== 'running') continue;
    p.status = 'ready';
    p.attempts[p.stage] = Math.max(0, (p.attempts[p.stage] ?? 0) - 1);
    addEvent(p, p.stage, 'recovered');
  }
  return state;
}

export function saveState(file: string, state: FactoryState): void {
  writeJsonAtomic(file, state);
}

export function nextId(state: FactoryState, prefix: string): string {
  state.seq += 1;
  return `${prefix}${state.seq}`;
}

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u', â: 'a', î: 'i', û: 'u' };

export function slugify(title: string, maxWords = 4): string {
  const folded = title.replace(/[çğıİöşüÇĞÖŞÜâîû]/g, (c) => TR_MAP[c] ?? c).normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = folded.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, maxWords);
  const slug = words.join('-').slice(0, 40).replace(/-+$/g, '');
  return slug || 'product';
}

export function uniqueSlug(state: FactoryState, base: string, productsDir?: string): string {
  let slug = base;
  let i = 2;
  const taken = (s: string) => s in state.products || (productsDir ? fs.existsSync(path.join(productsDir, s)) : false);
  while (taken(slug)) slug = `${base}-${i++}`;
  return slug;
}

export function addEvent(p: Product, stage: string, event: string, note?: string): void {
  p.events.push({ at: nowIso(), stage, event, ...(note ? { note } : {}) });
  if (p.events.length > 200) p.events.splice(0, p.events.length - 200);
  p.updated_at = nowIso();
}

/** Single-instance lock. Returns a release function. */
export function acquireLock(file: string): () => void {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (pid && pid !== process.pid) {
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      if (alive) throw new Error(`Another foreman is running (pid ${pid}). Stop it first or remove ${file}.`);
    }
  }
  fs.writeFileSync(file, String(process.pid));
  return () => {
    try {
      if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file);
    } catch { /* already gone */ }
  };
}

export function submissionsInWindow(state: FactoryState, store: string, kind: Submission['kind'], now: Date, days = 30): Submission[] {
  const since = now.getTime() - days * 86_400_000;
  return state.submissions.filter((s) => s.store === store && s.kind === kind && Date.parse(s.at) >= since);
}
