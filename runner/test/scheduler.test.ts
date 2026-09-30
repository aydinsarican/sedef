import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, type PipelineConfig, type SedefConfig, type StageDef } from '../src/config.js';
import { inQuietHours, isDailyDue, isWeeklyDue, planJobs } from '../src/scheduler.js';
import { budgetLeft, sessionBudget } from '../src/budget.js';
import { emptyState, type FactoryState, type Product } from '../src/state.js';

const TZ = 'Europe/Istanbul';
// 2026-09-30 is a Wednesday. 07:00Z = 10:00 in Istanbul (UTC+3).
const AT = (iso: string) => new Date(iso);

function stage(name: string, over: Partial<StageDef> = {}): StageDef {
  return {
    name, scope: 'product', model: 'lead', prompt: `${name}.md`, tools: { allow: [], deny: [] }, mcp: [], web: 'none', secrets: [],
    max_turns: 10, budget_usd: 1, timeout_minutes: 10, verify: [], max_attempts: 2, on_exhausted: 'park', immutable: [], writable_extra: [], reset: [], irreversible: [], wip: true,
    ...over,
  };
}

const pipeline: PipelineConfig = (() => {
  const stages: Record<string, StageDef> = {
    scout: stage('scout', { scope: 'factory', wip: false }),
    portfolio: stage('portfolio', { scope: 'factory', wip: false }),
    grow: stage('grow', { wip: false }),
    validate: stage('validate'),
    build: stage('build'),
    release: stage('release'),
    release_watch: stage('release_watch', { wip: false }),
  };
  return { stages, order: Object.keys(stages), factory_stages: ['scout', 'portfolio'] };
})();

const config: SedefConfig = { ...DEFAULT_CONFIG, factory: { ...DEFAULT_CONFIG.factory, timezone: TZ } };

function product(slug: string, stageName: string, over: Partial<Product> = {}): Product {
  return {
    slug, title: slug, lane: 'ios', idea_id: 'i1', source: 'scout', stage: stageName, status: 'ready', attempts: {}, replans: 0,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', dir: `/tmp/${slug}`, spend_usd: 0, submissions: 0, approvals: [], app_ids: {}, events: [],
    ...over,
  };
}

function state(products: Product[] = [], over: Partial<FactoryState> = {}): FactoryState {
  const s = emptyState();
  for (const p of products) s.products[p.slug] = p;
  // Pretend scout/portfolio already ran today so product ordering is isolated.
  s.schedule.last_scout_date = '2026-09-30';
  s.schedule.last_portfolio_date = '2026-09-30';
  return { ...s, ...over };
}

const zero = { today: 0, month: 0, byProduct: {} };

test('daily and weekly schedules respect the local time zone', () => {
  assert.equal(isDailyDue('08:30', undefined, AT('2026-09-30T05:00:00Z'), TZ), false); // 08:00 local
  assert.equal(isDailyDue('08:30', undefined, AT('2026-09-30T05:31:00Z'), TZ), true); // 08:31 local
  assert.equal(isDailyDue('08:30', '2026-09-30', AT('2026-09-30T09:00:00Z'), TZ), false);
  assert.equal(isWeeklyDue('wed 10:00', undefined, AT('2026-09-30T07:05:00Z'), TZ), true);
  assert.equal(isWeeklyDue('sun 10:00', '2026-09-27', AT('2026-09-30T07:05:00Z'), TZ), false);
  assert.equal(isWeeklyDue('sun 10:00', '2026-09-13', AT('2026-09-30T07:05:00Z'), TZ), true); // catch-up
});

test('quiet hours wrap around midnight', () => {
  assert.equal(inQuietHours(AT('2026-09-30T22:00:00Z'), TZ, ['00:30', '08:00']), true); // 01:00 local
  assert.equal(inQuietHours(AT('2026-09-30T06:00:00Z'), TZ, ['00:30', '08:00']), false); // 09:00 local
  assert.equal(inQuietHours(AT('2026-09-30T20:30:00Z'), TZ, ['23:00', '07:00']), true); // 23:30 local
  assert.equal(inQuietHours(AT('2026-09-30T12:00:00Z'), TZ, []), false);
});

test('paused factory and exhausted budget start nothing', () => {
  const now = AT('2026-09-30T07:00:00Z');
  assert.deepEqual(planJobs({ now, state: state([product('a', 'build')], { paused: true }), config, pipeline, running: new Set(), spend: zero }).jobs, []);
  const broke = planJobs({ now, state: state([product('a', 'build')]), config, pipeline, running: new Set(), spend: { today: 999, month: 999, byProduct: {} } });
  assert.deepEqual(broke.jobs, []);
  assert.match(broke.notes[0]!, /budget/);
});

test('products closest to launch run first, within the session slots', () => {
  const now = AT('2026-09-30T07:00:00Z');
  const plan = planJobs({ now, state: state([product('v', 'validate'), product('b', 'build'), product('r', 'release')]), config, pipeline, running: new Set(), spend: zero });
  assert.deepEqual(plan.jobs.map((j) => j.key), ['product:r', 'product:b']);
  const busy = planJobs({ now, state: state([product('v', 'validate'), product('b', 'build')]), config, pipeline, running: new Set(['product:x']), spend: zero });
  assert.deepEqual(busy.jobs.map((j) => j.key), ['product:b']);
});

test('waiting, blocked and running products are skipped until eligible', () => {
  const now = AT('2026-09-30T07:00:00Z');
  const products = [
    product('w1', 'release_watch', { status: 'waiting', wait_until: '2026-09-30T08:00:00Z' }),
    product('w2', 'release_watch', { status: 'waiting', wait_until: '2026-09-30T06:00:00Z' }),
    product('bl', 'build', { status: 'blocked' }),
    product('ru', 'build', { status: 'running' }),
  ];
  const plan = planJobs({ now, state: state(products), config, pipeline, running: new Set(['product:ru']), spend: zero });
  assert.deepEqual(plan.jobs.map((j) => j.key), ['product:w2']);
});

test('over-budget products are reported, not run', () => {
  const now = AT('2026-09-30T07:00:00Z');
  const plan = planJobs({ now, state: state([product('fat', 'build', { spend_usd: 5000 })]), config, pipeline, running: new Set(), spend: zero });
  assert.deepEqual(plan.jobs, []);
  assert.ok(plan.notes.includes('over_budget:fat'));

  // The cap is a pre-launch budget: a live product iterating on an update still runs.
  const live = planJobs({ now, state: state([product('live', 'build', { spend_usd: 5000, launched_at: '2026-08-01T00:00:00Z' })]), config, pipeline, running: new Set(), spend: zero });
  assert.deepEqual(live.jobs.map((j) => j.key), ['product:live']);
  assert.ok(!live.notes.includes('over_budget:live'));
});

test('scout runs when due and the pipeline has room; factory jobs get slots first', () => {
  const now = AT('2026-09-30T07:00:00Z'); // 10:00 local, after 08:30
  const s = state([product('b', 'build'), product('r', 'release')]);
  delete s.schedule.last_scout_date;
  const plan = planJobs({ now, state: s, config, pipeline, running: new Set(), spend: zero });
  assert.deepEqual(plan.jobs.map((j) => j.key), ['factory:scout', 'product:r']);

  const full = state([product('a', 'build'), product('b', 'build'), product('c', 'validate')]);
  delete full.schedule.last_scout_date;
  const p2 = planJobs({ now, state: full, config, pipeline, running: new Set(), spend: zero });
  assert.ok(!p2.jobs.some((j) => j.key === 'factory:scout'));
  assert.ok(p2.notes.some((n) => n.startsWith('scout skipped')));
});

test('parallel sessions share what is left of the day: reservations count', () => {
  const cfg: SedefConfig = { ...config, budgets_usd: { ...config.budgets_usd, daily: 60, monthly: 1200 } };
  const spent = { today: 45, month: 300, byProduct: {} };
  assert.equal(sessionBudget(12, spent, cfg), 12);
  assert.equal(sessionBudget(12, spent, cfg, 10), 5);   // another session already holds $10 of the $15 left
  assert.equal(sessionBudget(12, spent, cfg, 15), 0.5); // floor; the foreman won't launch at all below $0.50
  assert.equal(budgetLeft(spent, cfg, 15), 0);
  assert.equal(budgetLeft({ today: 0, month: 1195, byProduct: {} }, cfg), 5); // the month can be the tighter cap
});
