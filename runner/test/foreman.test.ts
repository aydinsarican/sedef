/**
 * Drives the real Foreman (scheduler → session → verification → routing → state) with a scripted
 * session in place of the Claude Agent SDK, against the real pipeline/policy config.
 * Needs `--experimental-test-module-mocks` (see package.json "test").
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface Outcome { ok: boolean; subtype: string; costUsd: number; turns: number; denials: number; timedOut: boolean; error?: string; accountError?: string; apiError?: string }
interface Req { cwd: string; title: string; budgetUsd: number }

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/test
const distSrc = path.resolve(here, '..', 'src');
const repo = path.resolve(here, '..', '..', '..');

let script: (req: Req) => Outcome = () => ok();
const calls: Req[] = [];
mock.module(pathToFileURL(path.join(distSrc, 'session.js')).href, {
  namedExports: {
    TRANSIENT_API_ERRORS: new Set(['server_error', 'overloaded', 'rate_limit', 'unknown']),
    ACCOUNT_ERRORS: new Set(['authentication_failed', 'billing_error']),
    runSession: async (req: Req) => { calls.push(req); return script(req); },
  },
});
mock.module(pathToFileURL(path.join(distSrc, 'scaffold.js')).href, {
  namedExports: {
    commitAll: async () => false,
    pushIfRemote: async () => undefined,
    applyLaneTemplate: async () => [],
    scaffoldProduct: async () => '',
    LANE_TEMPLATES: { ios: 'ios' },
  },
});

const { Foreman } = await import('../src/foreman.js');
const { resolvePaths } = await import('../src/paths.js');
const { loadConfig, loadPipeline, loadPolicy } = await import('../src/config.js');
const { emptyState } = await import('../src/state.js');
type ForemanT = InstanceType<typeof Foreman>;

function ok(over: Partial<Outcome> = {}): Outcome {
  return { ok: true, subtype: 'success', costUsd: 1, turns: 10, denials: 0, timedOut: false, ...over };
}
const write = (dir: string, rel: string, data: unknown) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
};
const readJ = (dir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

function factory(stage: string, spendToday = 0): { f: ForemanT; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-fm-'));
  for (const d of ['config', 'prompts', 'plugin', 'templates']) fs.symlinkSync(path.join(repo, d), path.join(root, d));
  const paths = resolvePaths(root);
  fs.mkdirSync(paths.factory, { recursive: true });
  const dir = path.join(root, 'products', 'tide');
  write(dir, '.sedef/lane.md', 'ios');
  write(dir, '.sedef/verify.sh', 'exit 0\n');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
  const s = emptyState();
  s.schedule = { last_scout_date: today, last_digest_date: today, last_portfolio_date: today, last_retro_date: today };
  const now = new Date().toISOString();
  s.products.tide = {
    slug: 'tide', title: 'Tide', lane: 'ios', idea_id: 'i1', source: 'scout', stage, status: 'ready', attempts: {}, replans: 0,
    created_at: now, updated_at: now, dir, spend_usd: 0, submissions: 0, approvals: [], app_ids: {}, events: [],
  };
  fs.writeFileSync(paths.state, JSON.stringify(s));
  if (spendToday) fs.writeFileSync(paths.spend, JSON.stringify({ at: now, stage: 'x', cost_usd: spendToday }) + '\n');
  const cfg = loadConfig(paths);
  cfg.notify.telegram = false;
  return { f: new Foreman(paths, cfg, loadPipeline(paths), loadPolicy(paths), {}), dir };
}

async function step(f: ForemanT): Promise<void> {
  const p = f.state.products.tide!;
  if (p.status === 'waiting') { p.status = 'ready'; delete p.wait_until; } // time passes
  await f.tick();
  const running = (f as unknown as { running: Map<string, unknown> }).running;
  for (let i = 0; i < 400 && running.size; i++) await new Promise((r) => setTimeout(r, 10));
}

test('a session that ran out of turns does not pass on its outputs', async () => {
  const { f, dir } = factory('store');
  script = (req) => {
    write(req.cwd, '.sedef/store-plan.md', '# plan');
    write(req.cwd, '.sedef/compliance.json', { pass: true, findings: [] });
    return ok({ ok: false, subtype: 'error_max_turns' });
  };
  await step(f);
  const p = f.state.products.tide!;
  assert.equal(p.stage, 'store');
  assert.equal(p.attempts.store, 1);
  assert.match(p.last_error ?? '', /did not finish cleanly/);
  assert.ok(fs.existsSync(path.join(dir, '.sedef', 'feedback', 'store.md')));
});

test('a submission counts even when the session then ran out of turns', async () => {
  const { f, dir } = factory('release');
  script = (req) => { write(req.cwd, '.sedef/release.json', { status: 'submitted', store: 'apple', kind: 'new', app_id: '42' }); return ok({ ok: false, subtype: 'error_max_turns' }); };
  await step(f);
  const p = f.state.products.tide!;
  assert.equal(p.stage, 'release_watch');
  assert.equal(p.submissions, 1);
  assert.equal(f.state.submissions.length, 1);
  assert.equal(readJ(dir, '.sedef/release.json').status, 'recorded');
  assert.equal(p.app_ids.apple, '42');
});

test('"waiting for a human" with nothing asked backs off, then hands over to the human', async () => {
  const { f } = factory('release');
  script = (req) => { write(req.cwd, '.sedef/release.json', { status: 'waiting_human', store: 'apple' }); return ok(); };
  const waits: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await step(f);
    const p = f.state.products.tide!;
    if (p.wait_until) waits.push(Math.round((Date.parse(p.wait_until) - t0) / 60_000));
  }
  const p = f.state.products.tide!;
  assert.deepEqual(waits, [60, 120, 240, 480]);
  assert.equal(p.status, 'blocked');
  const chore = f.state.chores.find((c) => c.key === 'self-loop:release' && !c.done_at);
  assert.ok(chore, 'a blocking chore is raised');
  const before = calls.length;
  await step(f);
  assert.equal(calls.length, before, 'no more paid sessions while blocked');
  await f.finishChore(chore!.id, 'devam');
  assert.equal(f.state.products.tide!.status, 'ready');
  assert.equal(f.state.products.tide!.self_loops, undefined);
});

test('a stage only starts with its full budget free', async () => {
  const { f } = factory('store', 50); // $10 left today; store needs $14
  const before = calls.length;
  await step(f);
  assert.equal(calls.length, before);
  const { f: g } = factory('release_watch', 50); // needs $0.80
  script = (req) => { write(req.cwd, '.sedef/review-status.json', { next: 'wait', raw_state: 'WAITING_FOR_REVIEW' }); return ok({ costUsd: 0.1 }); };
  await step(g);
  assert.equal(calls.at(-1)!.budgetUsd, 0.8);
});

test('a refused API key pauses the factory and gives the attempt back', async () => {
  const { f } = factory('store');
  script = () => ok({ ok: false, subtype: 'no_result', costUsd: 0, turns: 0, accountError: 'authentication_failed', error: 'API refused the account' });
  await step(f);
  assert.equal(f.state.paused, true);
  assert.equal(f.state.pause_reason, 'api:authentication_failed');
  assert.equal(f.state.products.tide!.attempts.store, 0);
  const before = calls.length;
  await step(f);
  assert.equal(calls.length, before, 'nothing runs while paused');
});

test('an outage backs off without burning attempts, three times at most', async () => {
  const { f } = factory('store');
  script = () => ok({ ok: false, subtype: 'error_api', costUsd: 0, turns: 1, apiError: 'server_error' });
  for (let i = 0; i < 3; i++) await step(f);
  let p = f.state.products.tide!;
  assert.equal(p.attempts.store, 0);
  assert.equal(p.api_failures, 3);
  await step(f);
  p = f.state.products.tide!;
  assert.equal(p.attempts.store, 1, 'the fourth loss in a row counts');
});

test('QA ⇄ build ping-pong parks the product instead of running forever', async () => {
  const { f, dir } = factory('build');
  write(dir, '.sedef/progress.json', { phases_total: 3, phases_done: 2, complete: false, current: 3 });
  script = (req) => {
    if (req.title.includes('· build')) {
      const prog = readJ(req.cwd, '.sedef/progress.json');
      write(req.cwd, '.sedef/progress.json', { ...prog, phases_done: prog.phases_done + 1, phases_total: prog.phases_done + 1, complete: true });
    } else if (req.title.includes('· qa')) {
      write(req.cwd, '.sedef/qa-report.md', '# qa');
      write(req.cwd, '.sedef/qa.json', { verdict: 'fix', blockers: 1, majors: 0, minors: 0, crashes: 0 });
    }
    return ok();
  };
  for (let i = 0; i < 20 && f.state.products.tide!.status !== 'failed'; i++) await step(f);
  const p = f.state.products.tide!;
  assert.equal(p.status, 'failed');
  assert.match(p.last_error ?? '', /döngü/);
  assert.ok((p.visits?.[p.stage] ?? 0) > 6);
});
