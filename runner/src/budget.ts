import type { SedefConfig } from './config.js';
import { appendJsonl, localParts, readJsonl } from './util.js';

export interface SpendRow {
  at: string;
  product?: string;
  stage: string;
  session_id?: string;
  cost_usd: number;
  turns?: number;
  outcome?: string;
}

export interface SpendTotals {
  today: number;
  month: number;
  byProduct: Record<string, number>;
}

export function recordSpend(file: string, row: SpendRow): void {
  appendJsonl(file, row);
}

export function spendTotals(rows: SpendRow[], now: Date, timeZone: string): SpendTotals {
  const today = localParts(now, timeZone).date;
  const month = today.slice(0, 7);
  const totals: SpendTotals = { today: 0, month: 0, byProduct: {} };
  for (const r of rows) {
    const cost = Number(r.cost_usd) || 0;
    const d = localParts(new Date(r.at), timeZone).date;
    if (d === today) totals.today += cost;
    if (d.startsWith(month)) totals.month += cost;
    if (r.product) totals.byProduct[r.product] = (totals.byProduct[r.product] ?? 0) + cost;
  }
  return totals;
}

export function loadSpend(file: string, now: Date, timeZone: string): SpendTotals {
  return spendTotals(readJsonl<SpendRow>(file), now, timeZone);
}

export function budgetGate(t: SpendTotals, cfg: SedefConfig): { ok: boolean; reason?: string } {
  if (t.today >= cfg.budgets_usd.daily) return { ok: false, reason: `daily budget reached ($${t.today.toFixed(2)} / $${cfg.budgets_usd.daily})` };
  if (t.month >= cfg.budgets_usd.monthly) return { ok: false, reason: `monthly budget reached ($${t.month.toFixed(2)} / $${cfg.budgets_usd.monthly})` };
  return { ok: true };
}

/** Cap a session's budget so one run cannot blow through the day's remaining allowance. */
/**
 * The cap for one session: the stage budget, but never more than what is left today / this month
 * after the budgets already handed to sessions that are still running (`reserved`).
 */
export function sessionBudget(stageBudget: number, t: SpendTotals, cfg: SedefConfig, reserved = 0): number {
  return Math.max(0.5, Math.min(stageBudget, budgetLeft(t, cfg, reserved)));
}

/**
 * What must be free before a stage may start: its full budget, or the whole daily/monthly cap if that is
 * smaller. A session is never launched underfunded — it would fail on the budget cap, not on its own merits.
 */
export function requiredBudget(stageBudget: number, cfg: SedefConfig): number {
  return Math.max(0.5, Math.min(stageBudget, cfg.budgets_usd.daily, cfg.budgets_usd.monthly));
}

export function budgetLeft(t: SpendTotals, cfg: SedefConfig, reserved = 0): number {
  return Math.min(cfg.budgets_usd.daily - t.today, cfg.budgets_usd.monthly - t.month) - reserved;
}
