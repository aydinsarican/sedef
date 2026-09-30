import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StageDef } from '../src/config.js';
import { buildMcpServers } from '../src/mcp.js';
import { apiBackoffMinutes, progressOk, resolveAfterFail, resolveAfterPass, routeValueError, selfLoopBackoffMinutes } from '../src/routing.js';
import { prepareStageFiles, wireIosAppIcon } from '../src/foreman.js';
import { completeChore, consumeProductChores, recordChoreAnswer, upsertChore } from '../src/chores.js';
import { copyTemplate, pascalName } from '../src/scaffold.js';
import { emptyState, loadState, slugify, uniqueSlug, type Product } from '../src/state.js';
import { ACCOUNT_ERRORS } from '../src/session.js';
import { render } from '../src/template.js';
import { expandVars, loadEnvFile, missingVars } from '../src/env.js';
import { restoreSnapshot, runChecks, snapshotFiles } from '../src/verify.js';
import { globToRegExp, walkFiles } from '../src/util.js';
import { isAllowedDataUrl, rdapRedirectTarget } from '../src/datatool.js';

function stage(name: string, over: Partial<StageDef> = {}): StageDef {
  return {
    name, scope: 'product', model: 'lead', prompt: `${name}.md`, tools: { allow: [], deny: [] }, mcp: [], web: 'none', secrets: [],
    max_turns: 10, budget_usd: 1, timeout_minutes: 10, verify: [], max_attempts: 2, on_exhausted: 'park', immutable: [], writable_extra: [], reset: [], irreversible: [], wip: true,
    ...over,
  };
}

const stages: Record<string, StageDef> = {
  validate: stage('validate', { route: { file: 'v.json', field: 'decision', map: { go: 'spec', kill: 'killed' } } }),
  spec: stage('spec', { next: 'build' }),
  build: stage('build', { route: { file: 'p.json', field: 'complete', map: { true: 'qa', false: 'build' } }, progress: { file: 'p.json', field: 'phases_done' }, max_attempts: 3, on_exhausted: 'goto:spec' }),
  release: stage('release', { route: { file: 'rel.json', field: 'status', map: { submitted: 'release_watch', waiting_human: 'release' } } }),
  qa: stage('qa'),
  release_watch: stage('release_watch', { poll_minutes: 120, enter_delay_minutes: 60, route: { file: 'r.json', field: 'next', map: { wait: 'release_watch', launch: 'launch' } } }),
  launch: stage('launch', { next: 'grow' }),
  grow: stage('grow', { enter_delay_minutes: 10080, poll_minutes: 10080 }),
};
const NOW = new Date('2026-09-30T10:00:00Z');

test('routing after a pass: verdict maps, loops, polls and delays', () => {
  assert.deepEqual(resolveAfterPass('validate', stages.validate!, stages, 'go', NOW), { stage: 'spec', status: 'ready', reason: 'advance' });
  assert.equal(resolveAfterPass('validate', stages.validate!, stages, 'kill', NOW).stage, 'killed');
  assert.equal(resolveAfterPass('validate', stages.validate!, stages, 'kill', NOW).status, 'done');
  assert.equal(resolveAfterPass('build', stages.build!, stages, 'false', NOW).status, 'ready');
  assert.equal(resolveAfterPass('build', stages.build!, stages, 'true', NOW).stage, 'qa');
  const poll = resolveAfterPass('release_watch', stages.release_watch!, stages, 'wait', NOW);
  assert.equal(poll.status, 'waiting');
  assert.equal(poll.wait_until, '2026-09-30T12:00:00.000Z');
  const human = resolveAfterPass('release', stages.release!, stages, 'waiting_human', NOW);
  assert.deepEqual(human, { stage: 'release', status: 'waiting', wait_until: '2026-09-30T11:00:00.000Z', reason: 'self-loop backoff' });
  assert.equal(resolveAfterPass('release', stages.release!, stages, 'waiting_human', NOW, 2).wait_until, '2026-09-30T14:00:00.000Z'); // 4 h
  assert.equal(selfLoopBackoffMinutes(10), 24 * 60); // capped at a day
  const grow = resolveAfterPass('launch', stages.launch!, stages, undefined, NOW);
  assert.equal(grow.stage, 'grow');
  assert.equal(grow.wait_until, '2026-10-07T10:00:00.000Z');
});

test('routing after a failure: retry, then replan with a limit, or park', () => {
  assert.equal(resolveAfterFail('build', stages.build!, 1, 0, 2).reason, 'retry');
  assert.deepEqual(resolveAfterFail('build', stages.build!, 3, 0, 2), { stage: 'spec', status: 'ready', reason: 'exhausted→replan' });
  assert.equal(resolveAfterFail('build', stages.build!, 3, 2, 2).status, 'failed');
  assert.equal(resolveAfterFail('spec', stages.spec!, 2, 0, 2).status, 'failed');
});

test('build progress must strictly increase from the recorded baseline', () => {
  assert.equal(progressOk(0, undefined), false); // first session with nothing recorded
  assert.equal(progressOk(1, undefined), true);
  assert.equal(progressOk(2, 2), false);
  assert.equal(progressOk(3, 2), true);
  assert.equal(progressOk(Number.NaN, 0), false); // progress file missing
});

test('transient API losses back off 15→30→60 min for free, then count as failures', () => {
  assert.equal(apiBackoffMinutes(1), 15);
  assert.equal(apiBackoffMinutes(2), 30);
  assert.equal(apiBackoffMinutes(3), 60);
  assert.equal(apiBackoffMinutes(4), undefined);
  assert.equal(apiBackoffMinutes(0), undefined);
  assert.equal(apiBackoffMinutes(5, 8), 120);
});

test('a route value that leads nowhere is a failed attempt, not "done"', () => {
  const release = stages.release!;
  assert.equal(routeValueError(release, 'submitted'), undefined);
  assert.match(routeValueError(release, undefined) ?? '', /must be one of: submitted, waiting_human \(found nothing\)/);
  assert.match(routeValueError(release, 'uploaded') ?? '', /found "uploaded"/);
  assert.equal(routeValueError(stages.spec!, undefined), undefined); // no route
  assert.equal(routeValueError(stage('x', { route: { file: 'f', field: 'v', map: { a: 'spec' } }, next: 'qa' }), 'zzz'), undefined); // falls back to next
});

test('stage files: verdicts move aside every attempt; a stateful route field is blanked on the first attempt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-prep-'));
  fs.mkdirSync(path.join(dir, '.sedef'));
  fs.writeFileSync(path.join(dir, '.sedef', 'qa.json'), '{"verdict":"pass"}');
  fs.writeFileSync(path.join(dir, '.sedef', 'release.json'), '{"status":"recorded","app_id":"123"}');
  const qa = stage('qa', { reset: ['.sedef/qa.json'], route: { file: '.sedef/qa.json', field: 'verdict', map: { pass: 'store', fix: 'build' } } });
  prepareStageFiles(dir, qa, 1);
  assert.ok(!fs.existsSync(path.join(dir, '.sedef', 'qa.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'qa.prev.json'), 'utf8')).verdict, 'pass');
  const rel = stage('release', { route: { file: '.sedef/release.json', field: 'status', map: { submitted: 'release_watch' } } });
  prepareStageFiles(dir, rel, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'release.json'), 'utf8')).status, 'recorded');
  prepareStageFiles(dir, rel, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'release.json'), 'utf8')), { status: null, app_id: '123' });
});

test('iOS app icon is wired into the asset catalog from the brand icon', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-icon-'));
  const set = path.join(dir, 'Tide', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset');
  fs.mkdirSync(set, { recursive: true });
  fs.writeFileSync(path.join(set, 'Contents.json'), '{"images":[{"idiom":"universal","platform":"ios","size":"1024x1024"}]}');
  assert.equal(wireIosAppIcon(dir), undefined); // no brand icon yet
  fs.mkdirSync(path.join(dir, 'design', 'brand'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'design', 'brand', 'icon-1024.png'), 'png');
  assert.equal(wireIosAppIcon(dir), path.join('Tide', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset'));
  assert.equal(fs.readFileSync(path.join(set, 'icon-1024.png'), 'utf8'), 'png');
  assert.equal(JSON.parse(fs.readFileSync(path.join(set, 'Contents.json'), 'utf8')).images[0].filename, 'icon-1024.png');
});

test('product chores are an outbox: consumed once, answers flow back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-chores-'));
  fs.mkdirSync(path.join(dir, '.sedef'));
  fs.writeFileSync(path.join(dir, '.sedef', 'chores.json'), JSON.stringify([{ key: 'app-record', kind: 'store', title: 'Create the app record', instructions: 'ASC → New App', blocking: true }]));
  assert.equal(consumeProductChores(dir).inputs.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'chores.json'), 'utf8')), []);
  assert.equal(consumeProductChores(dir).inputs.length, 0); // nothing resurrects on the next session
  fs.writeFileSync(path.join(dir, '.sedef', 'chores.json'), JSON.stringify([{ title: 'Play uygulamasını oluştur', blocking: true }, { note: 'no title' }]));
  const lenient = consumeProductChores(dir);
  assert.equal(lenient.inputs[0]!.key, 'chore-play-uygulamasini-olustur');
  assert.equal(lenient.inputs[0]!.instructions, 'Play uygulamasını oluştur');
  assert.equal(lenient.rejected.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'chores-history.json'), 'utf8'))[0].key, 'app-record');
  const s = emptyState();
  const c = upsertChore(s, { key: 'cws-item', kind: 'store', title: 'Create the CWS item', instructions: 'Reply with the item id' }, 'tide')!;
  completeChore(s, c.id, 'abcdefghijklmnop');
  recordChoreAnswer(dir, c);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.sedef', 'chore-answers.json'), 'utf8'))[0].choice, 'abcdefghijklmnop');
});

test('a restart gives back the attempt that was interrupted mid-session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-state-'));
  const file = path.join(dir, 'state.json');
  const s = emptyState();
  s.products.demo = {
    slug: 'demo', title: 'Demo', lane: 'ios', source: 'scout', stage: 'build', status: 'running', attempts: { build: 2 }, replans: 0,
    dir, spend_usd: 0, submissions: 0, approvals: {}, app_ids: {}, events: [], created_at: '', updated_at: '',
  } as unknown as Product;
  s.products.idle = { ...s.products.demo, slug: 'idle', status: 'waiting', attempts: { build: 1 }, events: [] } as Product;
  fs.writeFileSync(file, JSON.stringify(s));
  const loaded = loadState(file);
  assert.equal(loaded.products.demo!.status, 'ready');
  assert.equal(loaded.products.demo!.attempts.build, 1);
  assert.equal(loaded.products.demo!.events.at(-1)?.event, 'recovered');
  assert.equal(loaded.products.idle!.status, 'waiting');
  assert.equal(loaded.products.idle!.attempts.build, 1);
});

test('account-level API errors stop a session; transient ones are left to the SDK retry', () => {
  for (const e of ['authentication_failed', 'billing_error', 'account_on_hold', 'verification_required']) assert.ok(ACCOUNT_ERRORS.has(e), e);
  for (const e of ['rate_limit', 'overloaded', 'server_error', 'unknown', 'model_not_found']) assert.ok(!ACCOUNT_ERRORS.has(e), e);
});

test('slugs fold Turkish characters and stay unique', () => {
  assert.equal(slugify('Şehir Günlüğü: Çok İyi!'), 'sehir-gunlugu-cok-iyi');
  assert.equal(slugify('Sörfçüler için gelgit ve rüzgâr günlüğü'), 'sorfculer-icin-gelgit-ve');
  assert.equal(slugify('   '), 'product');
  const s = emptyState();
  s.products['mood'] = {} as never;
  assert.equal(uniqueSlug(s, 'mood'), 'mood-2');
  assert.equal(pascalName('mood-atlas'), 'MoodAtlas');
  assert.equal(pascalName('7-minute'), 'App7Minute');
});

test('template rendering and env expansion', () => {
  assert.equal(render('Hi {{product.slug}} ({{ attempt }}){{missing.key}}', { product: { slug: 'x' }, attempt: 2 }), 'Hi x (2)');
  assert.equal(expandVars('${A}/${B:-dflt}/$C', { A: 'a', C: 'c' }), 'a/dflt/c');
  assert.deepEqual(missingVars('Bearer ${KEY} ${OPT:-x}', {}), ['KEY']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-env-'));
  fs.writeFileSync(path.join(dir, '.env'), '# c\nFOO=bar\nexport BAZ="q z"\nKEEP=new\nWITH_COMMENT=v # note\n');
  const env: NodeJS.ProcessEnv = { KEEP: 'old' };
  loadEnvFile(path.join(dir, '.env'), env);
  assert.equal(env.FOO, 'bar');
  assert.equal(env.BAZ, 'q z');
  assert.equal(env.KEEP, 'old');
  assert.equal(env.WITH_COMMENT, 'v');
});

test('glob matching', () => {
  assert.ok(globToRegExp('**/.env').test('/a/b/.env'));
  assert.ok(globToRegExp('**/.env').test('.env'));
  assert.ok(globToRegExp('/x/.maestro/acceptance/**').test('/x/.maestro/acceptance/a/b.yaml'));
  assert.ok(!globToRegExp('/x/*.md').test('/x/a/b.md'));
});

test('mcp builder expands secrets, skips servers with missing keys, keeps oauth servers', () => {
  const catalog = {
    fal: { type: 'http' as const, url: 'https://mcp.fal.ai/mcp', headers: { Authorization: 'Bearer ${FAL_KEY}' } },
    local: { command: 'npx', args: ['-y', 'x'], env: { J: '${J:-/opt/j}' } },
    oauth: { type: 'http' as const, url: 'https://mcp.figma.com/mcp', auth: 'oauth' as const },
  };
  const built = buildMcpServers(catalog, ['fal', 'local', 'oauth', 'nope'], { PATH: '/bin', HOME: '/h' });
  assert.deepEqual(Object.keys(built.servers).sort(), ['local', 'oauth']);
  assert.deepEqual(built.skipped.map((s) => s.name).sort(), ['fal', 'nope']);
  const withKey = buildMcpServers(catalog, ['fal'], { FAL_KEY: 'k' });
  assert.deepEqual((withKey.servers.fal as { headers: Record<string, string> }).headers, { Authorization: 'Bearer k' });
  assert.equal((built.servers.local as { env: Record<string, string> }).env.J, '/opt/j');
});

test('verification checks and tamper-proof snapshots', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-verify-'));
  fs.mkdirSync(path.join(dir, '.sedef'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.maestro', 'acceptance'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sedef', 'verdict.json'), JSON.stringify({ decision: 'go' }));
  fs.writeFileSync(path.join(dir, '.sedef', 'verify.sh'), 'exit 0\n');
  fs.writeFileSync(path.join(dir, '.maestro', 'acceptance', 'a.yaml'), 'appId: x\n');

  const ok = await runChecks([
    { kind: 'files_exist', paths: ['.sedef/verdict.json'] },
    { kind: 'json_field', file: '.sedef/verdict.json', field: 'decision', one_of: ['go', 'kill'] },
    { kind: 'command', run: 'test -f .sedef/verify.sh', timeout_seconds: 10 },
  ], dir, { env: process.env, novelty: () => ({ pass: true, violations: [] }) });
  assert.deepEqual(ok, { pass: true, failures: [] });

  const bad = await runChecks([
    { kind: 'files_exist', paths: ['missing.md'] },
    { kind: 'json_field', file: '.sedef/verdict.json', field: 'decision', one_of: ['kill'] },
    { kind: 'command', run: 'echo boom; exit 3', timeout_seconds: 10 },
    { kind: 'novelty' },
  ], dir, { env: process.env, novelty: () => ({ pass: false, violations: ['too close'] }) });
  assert.equal(bad.pass, false);
  assert.equal(bad.failures.length, 4);
  assert.match(bad.failures[2]!, /boom/);

  const globs = ['.sedef/verify.sh', '.maestro/acceptance/**'];
  const re = globs.map((g) => globToRegExp(path.join(dir, g)));
  const matches = (abs: string) => re.some((r) => r.test(abs));
  const snap = snapshotFiles(dir, globs, walkFiles, matches);
  fs.writeFileSync(path.join(dir, '.sedef', 'verify.sh'), 'echo pwned\n');
  fs.rmSync(path.join(dir, '.maestro', 'acceptance', 'a.yaml'));
  fs.writeFileSync(path.join(dir, '.maestro', 'acceptance', 'sneaky.yaml'), 'x');
  const touched = restoreSnapshot(snap, dir, walkFiles, matches);
  assert.equal(touched.length, 3);
  assert.equal(fs.readFileSync(path.join(dir, '.sedef', 'verify.sh'), 'utf8'), 'exit 0\n');
  assert.ok(fs.existsSync(path.join(dir, '.maestro', 'acceptance', 'a.yaml')));
  assert.ok(!fs.existsSync(path.join(dir, '.maestro', 'acceptance', 'sneaky.yaml')));
});

test('data tool allow-list: https only, listed hosts only, no credentials', () => {
  assert.equal(isAllowedDataUrl('https://itunes.apple.com/search?term=habit&entity=software').ok, true);
  assert.equal(isAllowedDataUrl('https://rdap.org/domain/tide.app').ok, true);
  assert.equal(isAllowedDataUrl('http://itunes.apple.com/search?term=x').ok, false);
  assert.equal(isAllowedDataUrl('https://evil.example.com/?q=secrets').ok, false);
  assert.equal(isAllowedDataUrl('https://user:pw@itunes.apple.com/search').ok, false);
  assert.equal(isAllowedDataUrl('not a url').ok, false);
  const built = buildMcpServers({}, ['sedef_data'], {});
  assert.equal((built.servers.sedef_data as { type: string }).type, 'sdk');
});

test('rdap redirects are followed only to https RDAP domain paths', () => {
  const from = new URL('https://rdap.org/domain/tidebook.com');
  assert.equal(rdapRedirectTarget(from, 'https://rdap.verisign.com/com/v1/domain/tidebook.com')?.hostname, 'rdap.verisign.com');
  assert.equal(rdapRedirectTarget(from, 'http://rdap.verisign.com/com/v1/domain/tidebook.com'), undefined);
  assert.equal(rdapRedirectTarget(from, 'https://evil.example/collect?x=1'), undefined);
  assert.equal(rdapRedirectTarget(from, 'https://user:pw@rdap.example/domain/x.com'), undefined);
});

test('template copy renders placeholders, strips .tmpl and never overwrites', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-tpl-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-dst-'));
  fs.mkdirSync(path.join(src, '.sedef'));
  fs.writeFileSync(path.join(src, 'project.yml.tmpl'), 'name: {{APP_NAME}}\nbundle: {{BUNDLE_ID}}\nkeep: {{UNKNOWN}}\n');
  fs.writeFileSync(path.join(src, '.sedef', 'verify.sh'), '#!/bin/bash\necho {{PRODUCT_SLUG}}\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dst, 'CLAUDE.md'), 'mine');
  fs.writeFileSync(path.join(src, 'CLAUDE.md'), 'theirs');
  const created = copyTemplate(src, dst, { APP_NAME: 'MoodAtlas', BUNDLE_ID: 'com.x.moodatlas', PRODUCT_SLUG: 'mood-atlas' });
  assert.deepEqual(created.sort(), ['.sedef/verify.sh', 'project.yml']);
  assert.equal(fs.readFileSync(path.join(dst, 'project.yml'), 'utf8'), 'name: MoodAtlas\nbundle: com.x.moodatlas\nkeep: {{UNKNOWN}}\n');
  assert.equal(fs.readFileSync(path.join(dst, 'CLAUDE.md'), 'utf8'), 'mine');
  assert.ok((fs.statSync(path.join(dst, '.sedef', 'verify.sh')).mode & 0o111) !== 0);
});
