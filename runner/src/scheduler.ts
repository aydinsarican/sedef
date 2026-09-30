import type { PipelineConfig, SedefConfig } from './config.js';
import { budgetGate, type SpendTotals } from './budget.js';
import type { FactoryState, Product } from './state.js';
import { localParts } from './util.js';

export type Job =
  | { kind: 'stage'; key: string; product: string; stage: string }
  | { kind: 'factory'; key: string; stage: string };

export interface PlanInput {
  now: Date;
  state: FactoryState;
  config: SedefConfig;
  pipeline: PipelineConfig;
  running: Set<string>;
  spend: SpendTotals;
}

export interface Plan {
  jobs: Job[];
  notes: string[];
  digestDue: boolean;
}

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const daysBetween = (a: string, b: string): number => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** "HH:MM" daily schedule: due once per local day, at or after the time. */
export function isDailyDue(spec: string, lastDate: string | undefined, now: Date, tz: string): boolean {
  const p = localParts(now, tz);
  if (lastDate === p.date) return false;
  return p.time >= spec;
}

/** "sun 10:00" weekly schedule; catches up if the last run is more than a week old. */
export function isWeeklyDue(spec: string, lastDate: string | undefined, now: Date, tz: string): boolean {
  const [dayStr, time] = spec.split(' ');
  const target = DAYS[(dayStr ?? '').toLowerCase()];
  const p = localParts(now, tz);
  if (lastDate === p.date) return false;
  if (p.weekday === target && p.time >= (time ?? '00:00')) return true;
  return lastDate !== undefined && daysBetween(lastDate, p.date) > 7;
}

export function inQuietHours(now: Date, tz: string, window: [string, string] | []): boolean {
  if (window.length !== 2) return false;
  const [start, end] = window;
  const t = localParts(now, tz).time;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function isWip(p: Product, pipeline: PipelineConfig): boolean {
  if (p.status === 'done' || p.status === 'failed') return false;
  const def = pipeline.stages[p.stage];
  return def ? def.wip : false;
}

function isEligible(p: Product, now: Date, running: Set<string>, pipeline: PipelineConfig): boolean {
  if (running.has(`product:${p.slug}`)) return false;
  if (!(p.stage in pipeline.stages)) return false;
  if (p.status === 'ready') return true;
  return p.status === 'waiting' && !!p.wait_until && Date.parse(p.wait_until) <= now.getTime();
}

export function planJobs(inp: PlanInput): Plan {
  const { now, state, config, pipeline, running, spend } = inp;
  const tz = config.factory.timezone;
  const notes: string[] = [];
  const jobs: Job[] = [];
  const digestDue = isDailyDue(config.schedules.digest, state.schedule.last_digest_date, now, tz);

  if (state.paused) return { jobs, notes: ['paused'], digestDue };
  const gate = budgetGate(spend, config);
  if (!gate.ok) return { jobs, notes: [`budget: ${gate.reason}`], digestDue };

  let slots = config.concurrency.max_parallel_sessions - running.size;
  if (slots <= 0) return { jobs, notes: ['all session slots busy'], digestDue };

  // Factory-level jobs first: they are rare (daily/weekly) and must not starve.
  const due: string[] = [];
  if (pipeline.stages.scout && isDailyDue(config.schedules.scout, state.schedule.last_scout_date, now, tz)) {
    const active = Object.values(state.products).filter((p) => isWip(p, pipeline)).length;
    const pending = Object.values(state.ideas).filter((i) => i.status === 'pending').length;
    if (active >= config.concurrency.max_active_products) notes.push(`scout skipped: ${active} products in the pipeline (max ${config.concurrency.max_active_products})`);
    else if (pending >= config.autonomy.max_pending_ideas) notes.push(`scout skipped: ${pending} ideas still waiting for a decision`);
    else due.push('scout');
  }
  if (pipeline.stages.portfolio && isWeeklyDue(config.schedules.portfolio_review, state.schedule.last_portfolio_date, now, tz)) due.push('portfolio');
  if (pipeline.stages.retro && isWeeklyDue(config.schedules.retro, state.schedule.last_retro_date, now, tz)) due.push('retro');
  for (const stage of due) {
    const key = `factory:${stage}`;
    if (slots <= 0 || running.has(key)) continue;
    jobs.push({ kind: 'factory', key, stage });
    slots--;
  }

  // Product jobs: closest to launch first, then oldest.
  const rank = (stage: string) => pipeline.order.indexOf(stage);
  const eligible = Object.values(state.products)
    .filter((p) => isEligible(p, now, running, pipeline))
    .filter((p) => {
      const def = pipeline.stages[p.stage]!;
      const spent = Math.max(spend.byProduct[p.slug] ?? 0, p.spend_usd);
      // The per-product cap is the pre-launch budget; a live product's iterations answer to the daily/monthly caps and the portfolio review.
      if (def.wip && !p.launched_at && spent >= config.budgets_usd.per_product_to_launch) {
        notes.push(`over_budget:${p.slug}`);
        return false;
      }
      return true;
    })
    .sort((a, b) => rank(b.stage) - rank(a.stage) || a.updated_at.localeCompare(b.updated_at));

  for (const p of eligible) {
    if (slots <= 0) break;
    jobs.push({ kind: 'stage', key: `product:${p.slug}`, product: p.slug, stage: p.stage });
    slots--;
  }
  return { jobs, notes, digestDue };
}
