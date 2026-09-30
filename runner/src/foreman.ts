/**
 * The foreman: a deterministic control loop (no LLM in the control path).
 * It plans jobs, launches one fresh agent session per unit of work, verifies
 * results with checks the agents cannot edit, routes products through the
 * pipeline, and talks to the human only at the idea gate and for batched chores.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { budgetLeft, loadSpend, recordSpend, requiredBudget, sessionBudget, type SpendTotals } from './budget.js';
import { completeChore, consumeProductChores, formatChore, pendingChores, recordChoreAnswer, upsertChore, type ChoreInput } from './chores.js';
import { modelFor, TERMINAL_STAGES, type McpCatalog, type PipelineConfig, type PolicyConfig, type SedefConfig, type StageDef } from './config.js';
import { dailyDigest, stageTr, statusSummary } from './digest.js';
import { buildMcpServers } from './mcp.js';
import { checkNovelty, type Fingerprint, type NoveltyResult } from './novelty.js';
import { expandHome, type Paths } from './paths.js';
import { matchesAny, type PolicyContext } from './policy.js';
import { apiBackoffMinutes, CYCLE_RESET_STAGES, MAX_SELF_LOOPS, MAX_STAGE_VISITS, progressOk, resolveAfterFail, resolveAfterPass, routeValueError, type RouteDecision } from './routing.js';
import { applyLaneTemplate, commitAll, LANE_TEMPLATES, pushIfRemote, scaffoldProduct } from './scaffold.js';
import { inQuietHours, planJobs, type Job } from './scheduler.js';
import { runSession, TRANSIENT_API_ERRORS, type Escalation } from './session.js';
import { acquireLock, addEvent, loadState, nextId, saveState, slugify, submissionsInWindow, uniqueSlug, type Chore, type FactoryState, type Idea, type Product } from './state.js';
import { Telegram, type Buttons, type TgUpdate } from './telegram.js';
import { render } from './template.js';
import { restoreSnapshot, runChecks, snapshotFiles } from './verify.js';
import { applyProposal, listProposals } from './proposals.js';
import { addMinutes, ensureDir, getField, htmlEscape, killAllCommands, localParts, nowIso, setField, readJson, readJsonl, readText, sleep, truncate, walkFiles, writeFileAtomic, writeJsonAtomic } from './util.js';

const BASE_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM', 'JAVA_HOME', 'DEVELOPER_DIR', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_MAX_RETRIES', 'API_TIMEOUT_MS'];

/**
 * Built-in tools a factory session may have. Anything else (self-scheduling like
 * CronCreate/ScheduleWakeup/RemoteTrigger, push notifications, artifacts, plan mode,
 * questions to a human who isn't there) simply doesn't exist in factory sessions.
 */
export const KNOWN_TOOLS = new Set(['Agent', 'Skill', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TaskStop', 'EnterWorktree', 'ExitWorktree']);
const BASE_TOOLS = ['Skill', 'Read', 'Glob', 'Grep', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TaskStop'];

export function stageTools(def: StageDef): string[] {
  const wanted = new Set([...BASE_TOOLS, ...def.tools.allow]);
  for (const d of def.tools.deny) wanted.delete(d);
  return [...wanted].filter((t) => KNOWN_TOOLS.has(t));
}

export const LANE_TR: Record<string, string> = {
  ios: 'iOS',
  expo_dual: 'iOS + Android',
  web_saas: 'Web SaaS',
  chrome_extension: 'Chrome eklentisi',
  mac_direct: 'Mac (doğrudan satış)',
  apify_actor: 'Apify aktörü',
  figma_plugin: 'Figma eklentisi',
  digital_assets: 'Dijital ürün',
  auto: 'kanal doğrulamada seçilecek',
};

/** What the human should do when the API refuses the account (keys: SDK error codes). */
export const ACCOUNT_HINTS_TR: Record<string, string> = {
  authentication_failed: 'API anahtarı geçersiz ya da iptal edilmiş. Yeni anahtarı kaydet: <code>./install.sh --set-api-key</code>',
  billing_error: 'Kredi bitti ya da harcama limiti doldu. Console → Billing üzerinden kredi ekle veya limiti yükselt.',
  account_on_hold: 'Hesap askıda. Console’a giriş yapıp uyarıyı çöz.',
  verification_required: 'Hesap doğrulama istiyor. Console’a giriş yapıp doğrulamayı tamamla.',
  oauth_org_not_allowed: 'OAuth token bu organizasyon için geçerli değil. <code>auth.mode</code> ayarını ve token’ı kontrol et.',
  cloud_credential_error: 'Bulut sağlayıcı kimlik bilgisi hatası. Kimlik bilgilerini yenile.',
};

interface IdeaCard {
  id?: string;
  title?: string;
  one_liner?: string;
  summary_tr?: string;
  lane?: string;
  score?: number | string;
  why_now?: string;
  wedge?: string;
  monetization?: string;
  distribution?: string;
}

export class Foreman {
  state: FactoryState;
  private readonly running = new Map<string, AbortController>();
  /** Factory jobs backing off after a transient API error (in memory; a restart simply retries). */
  private readonly factoryHold = new Map<string, number>();
  /** Budget handed to sessions that are still running — not spent yet, but no longer available. */
  private reservedUsd = 0;
  private readonly reservations = new Map<string, number>();
  private readonly tg?: Telegram;
  private stopping = false;
  private readonly stop = new AbortController();
  private readonly tz: string;

  constructor(
    private readonly paths: Paths,
    private readonly cfg: SedefConfig,
    private readonly pipeline: PipelineConfig,
    private readonly policy: PolicyConfig,
    private readonly catalog: McpCatalog,
  ) {
    this.state = loadState(paths.state);
    this.tz = cfg.factory.timezone;
    if (cfg.notify.telegram) this.tg = Telegram.fromEnv();
  }

  // ------------------------------------------------------------------ basics

  private mutate<T>(fn: (s: FactoryState) => T): T {
    const r = fn(this.state);
    saveState(this.paths.state, this.state);
    return r;
  }

  log(message: string): void {
    const line = `${nowIso()} ${message}`;
    console.log(line);
    try { fs.appendFileSync(path.join(ensureLogs(this.paths.logs), 'foreman.log'), line + '\n'); } catch { /* ignore */ }
  }

  private async notify(html: string, opts: { urgent?: boolean; buttons?: Buttons } = {}): Promise<number | undefined> {
    if (!this.tg) {
      this.log(`[notify] ${html.replace(/<[^>]+>/g, '')}`);
      return undefined;
    }
    if (!opts.urgent && !opts.buttons && inQuietHours(new Date(), this.tz, this.cfg.schedules.quiet_hours)) {
      this.mutate((s) => s.outbox.push({ text: html, at: nowIso() }));
      return undefined;
    }
    return this.tg.send(html, opts.buttons);
  }

  /** Account-level API failure: nothing can succeed until a human fixes it, so stop launching and say so once. */
  private async pauseForAccount(error: string): Promise<void> {
    if (this.state.paused) return;
    this.mutate((s) => { s.paused = true; s.pause_reason = `api:${error}`; });
    this.log(`paused: API refused the account (${error})`);
    const hint = ACCOUNT_HINTS_TR[error] ?? htmlEscape(error);
    await this.notify(`🔑 Anthropic API isteği reddetti (<code>${htmlEscape(error)}</code>) — fabrika durduruldu, ürünlerin deneme hakkı yanmadı.\n${hint}\nDüzelince /devam yaz.`, { urgent: true });
  }

  private async flushOutbox(now: Date): Promise<void> {
    if (!this.state.outbox.length || inQuietHours(now, this.tz, this.cfg.schedules.quiet_hours)) return;
    const text = this.state.outbox.map((m) => m.text).join('\n\n');
    this.mutate((s) => { s.outbox = []; });
    await this.notify(text, { urgent: true });
  }

  // -------------------------------------------------------------- main loop

  async start(opts: { once?: boolean } = {}): Promise<void> {
    const release = acquireLock(this.paths.lock);
    const shutdown = () => {
      if (this.stopping) return;
      this.log('shutdown requested — aborting running sessions');
      this.stopping = true;
      this.stop.abort();
      for (const c of this.running.values()) c.abort();
      const killed = killAllCommands('SIGTERM');
      if (killed) this.log(`stopped ${killed} running verifier command(s)`);
    };
    process.once('exit', () => { killAllCommands('SIGKILL'); });
    // launchd (and `timeout`, via the process group) may deliver SIGTERM more than once; stay graceful.
    // A second Ctrl-C in a terminal still exits immediately.
    process.on('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    this.log(`foreman up · ${Object.keys(this.state.products).length} products · telegram ${this.tg ? 'on' : 'off'}`);
    try {
      if (this.tg && !opts.once) void this.telegramLoop();
      do {
        try { await this.tick(); } catch (err) { this.log(`tick failed: ${(err as Error).stack ?? err}`); }
        if (opts.once) break;
        await sleep(this.cfg.schedules.heartbeat_seconds * 1000, this.stop.signal);
      } while (!this.stopping);
      await this.waitForRunning(opts.once ? 6 * 3600_000 : 90_000);
    } finally {
      saveState(this.paths.state, this.state);
      release();
    }
  }

  private async waitForRunning(maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (this.running.size && Date.now() < until) await sleep(1000);
  }

  async tick(): Promise<void> {
    const now = new Date();
    await this.processInbox();
    this.expireIdeas(now);
    await this.flushOutbox(now);
    const spend = loadSpend(this.paths.spend, now, this.tz);
    const plan = planJobs({ now, state: this.state, config: this.cfg, pipeline: this.pipeline, running: new Set(this.running.keys()), spend });
    for (const note of plan.notes) await this.handleNote(note, now);
    if (plan.digestDue) await this.sendDigest(now, spend);
    for (const job of plan.jobs) {
      // Parallel sessions share what is left of today's budget; a stage starts only with its full budget free.
      const need = requiredBudget(this.pipeline.stages[job.stage]!.budget_usd, this.cfg);
      if (budgetLeft(spend, this.cfg, this.reservedUsd) < need) {
        this.log(`${job.key} waits: needs $${need.toFixed(2)} free, $${Math.max(0, budgetLeft(spend, this.cfg, this.reservedUsd)).toFixed(2)} left after running sessions`);
        continue;
      }
      this.launch(job, spend);
    }
  }

  /** Commands queued by the CLI while the daemon holds the state file. */
  private async processInbox(): Promise<void> {
    const dir = path.join(this.paths.factory, 'inbox');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const file = path.join(dir, f);
      const item = readJson<{ cmd?: string; args?: string[] }>(file, {});
      fs.rmSync(file, { force: true });
      if (!item.cmd) continue;
      this.log(`inbox: ${item.cmd} ${(item.args ?? []).join(' ')}`);
      await this.handleCommand(item.cmd, (item.args ?? []).join(' '), item.args ?? []);
    }
  }

  private async handleNote(note: string, now: Date): Promise<void> {
    if (note.startsWith('budget:')) {
      const today = localParts(now, this.tz).date;
      if (this.state.schedule.budget_alert_date === today) return;
      this.mutate((s) => { s.schedule.budget_alert_date = today; });
      await this.notify(`💸 Bütçe sınırı: ${htmlEscape(note.slice(7).trim())}. Yeni oturum başlatılmıyor; sınır yarın/ay başında kendiliğinden açılır.`, { urgent: true });
    } else if (note.startsWith('over_budget:')) {
      const slug = note.slice('over_budget:'.length);
      const p = this.state.products[slug];
      if (!p || p.status === 'failed') return;
      this.mutate((s) => {
        const x = s.products[slug]!;
        x.status = 'failed';
        x.last_error = `lansman öncesi bütçe ($${this.cfg.budgets_usd.per_product_to_launch}) aşıldı`;
        addEvent(x, x.stage, 'parked', `${stageTr(x.stage)} aşamasında bütçe aşıldı, park edildi`);
      });
      await this.notify(`🧯 <b>${htmlEscape(slug)}</b> lansman öncesi bütçesini aştı ve park edildi. Portföy incelemesi karar verecek.`);
    }
  }

  private launch(job: Job, spend: SpendTotals): void {
    if (job.kind === 'factory' && (this.factoryHold.get(job.stage) ?? 0) > Date.now()) return;
    const ctrl = new AbortController();
    this.running.set(job.key, ctrl);
    // Reserve this session's budget now, synchronously, so the next job in the same tick sees it taken.
    const budgetUsd = sessionBudget(this.pipeline.stages[job.stage]!.budget_usd, spend, this.cfg, this.reservedUsd);
    this.reservations.set(job.key, budgetUsd);
    this.reservedUsd += budgetUsd;
    this.log(`▶ ${job.key} · ${job.stage} · ≤ $${budgetUsd.toFixed(2)}`);
    const work = job.kind === 'stage' ? this.runProductStage(job.product, job.stage, ctrl, budgetUsd) : this.runFactoryStage(job.stage, ctrl, budgetUsd);
    work
      .catch((err) => {
        this.log(`job ${job.key} crashed: ${(err as Error).stack ?? err}`);
        if (job.kind === 'stage') {
          // A runner bug must not become an endless loop of paid sessions: park once the stage's attempts are used up.
          const parked = this.mutate((s) => {
            const p = s.products[job.product];
            if (!p || p.status !== 'running') return false;
            p.last_error = truncate(String((err as Error).message ?? err), 300);
            const exhausted = (p.attempts[p.stage] ?? 0) >= (this.pipeline.stages[p.stage]?.max_attempts ?? 1);
            p.status = exhausted ? 'failed' : 'ready';
            addEvent(p, p.stage, 'crashed', p.last_error);
            return exhausted;
          });
          if (parked) void this.notify(`🧯 <b>${htmlEscape(job.product)}</b> park edildi: sedef çalışırken hata aldı (${htmlEscape(this.state.products[job.product]?.last_error ?? '')}). Ayrıntı: factory/logs/foreman.log`);
        }
      })
      .finally(() => { this.releaseReservation(job.key); this.running.delete(job.key); this.log(`■ ${job.key}`); });
  }

  /** Called once the session's real cost is in spend.jsonl (so it isn't counted twice), and again harmlessly at job end. */
  private releaseReservation(key: string): void {
    const amount = this.reservations.get(key);
    if (amount === undefined) return;
    this.reservations.delete(key);
    this.reservedUsd = Math.max(0, this.reservedUsd - amount);
  }

  // ------------------------------------------------------- session plumbing

  private sessionEnv(def: StageDef, product?: Product): Record<string, string> {
    const env: Record<string, string> = {};
    for (const k of BASE_ENV) if (process.env[k]) env[k] = process.env[k]!;
    for (const k of def.secrets) if (process.env[k]) env[k] = process.env[k]!;
    Object.assign(env, {
      SEDEF_HOME: this.paths.root,
      SEDEF_SDK_SESSION: '1',
      SEDEF_STAGE: def.name,
      ...(product ? { SEDEF_PRODUCT: product.slug, SEDEF_REPLANS: String(product.replans ?? 0) } : {}),
      SEDEF_SUPPORT_EMAIL: this.cfg.factory.support_email,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'sedef/0.1',
      DISABLE_AUTOUPDATER: '1',
      MCP_TIMEOUT: '90000',
    });
    if (this.cfg.auth.mode === 'env' && process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (this.cfg.auth.mode === 'oauth' && process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    return env;
  }

  private apiKeyHelper(): string | undefined {
    if (this.cfg.auth.mode !== 'keychain') return undefined;
    return `/usr/bin/security find-generic-password -a '${this.cfg.auth.keychain_account}' -s '${this.cfg.auth.keychain_service}' -w`;
  }

  private resolveRoot(p: string, cwd: string): string {
    if (p.startsWith('@factory/')) return path.join(this.paths.factory, p.slice(9));
    if (p.startsWith('~')) return expandHome(p);
    return path.isAbsolute(p) ? p : path.join(cwd, p);
  }

  private policyContext(def: StageDef, cwd: string, product?: Product): PolicyContext {
    const apple = submissionsInWindow(this.state, 'apple', 'new', new Date()).length;
    const google = submissionsInWindow(this.state, 'google', 'new', new Date()).length;
    const r = this.paths.root;
    return {
      stage: def.name,
      cwd,
      home: os.homedir(),
      writableRoots: [cwd, ...def.writable_extra.map((w) => this.resolveRoot(w, cwd)), os.tmpdir(), '/tmp', '/private/tmp', '/private/var/folders'],
      immutable: def.immutable,
      protectedWrite: [
        `${r}/config/**`, `${r}/runner/**`, `${r}/plugin/**`, `${r}/prompts/**`, `${r}/templates/**`, `${r}/scripts/**`, `${r}/bin/**`, `${r}/install.sh`,
        this.paths.state, this.paths.spend, this.paths.lock, `${this.paths.factory}/ledger/**`, `${this.paths.logs}/**`, `${this.paths.factory}/inbox/**`,
      ],
      mcpAllowed: def.mcp,
      web: def.web,
      ...(product ? { ownHosts: ownHosts(product.dir) } : {}),
      flags: {
        appleWebAutomation: this.cfg.autonomy.apple_web_session_automation,
        isNewApp: !product || ((product.submissions ?? 0) === 0 && !product.launched_at),
        submissionsLeft: this.cfg.autonomy.max_new_store_submissions_per_30d - Math.max(apple, google),
        firstSubmissionNeedsHuman: this.cfg.autonomy.first_submission_needs_human,
        firstSubmissionApproved: (product?.approvals ?? []).includes('first_submission') || (product?.submissions ?? 0) > 0,
      },
    };
  }

  private recentLedger(n = 8): Fingerprint[] {
    return readJsonl<Fingerprint>(this.paths.ledger).slice(-n);
  }

  private noveltyFor(cwd: string, slug: string): NoveltyResult {
    const fp = readJson<Fingerprint | undefined>(path.join(cwd, '.sedef', 'fingerprint.json'), undefined);
    if (!fp) return { pass: false, min_distance: null, compared: 0, violations: ['.sedef/fingerprint.json is missing'] };
    return checkNovelty({ ...fp, product: slug }, readJsonl<Fingerprint>(this.paths.ledger), this.cfg.novelty);
  }

  private promptVars(def: StageDef, attempt: number, feedback: string, product?: Product): Record<string, unknown> {
    const enabledLanes = Object.entries(this.cfg.lanes).filter(([, v]) => v.enabled).map(([k]) => k);
    return {
      today: localParts(new Date(), this.tz).date,
      attempt,
      feedback: feedback.trim() ? feedback.trim() : 'None — this is a clean attempt.',
      stage: { name: def.name, budget_usd: def.budget_usd, max_turns: def.max_turns },
      product: product ? { slug: product.slug, title: product.title, lane: product.lane, dir: product.dir, source: product.source, submissions: product.submissions, replans: product.replans ?? 0, app_ids: product.app_ids, launched_at: product.launched_at ?? 'not launched' } : {},
      factory: {
        name: this.cfg.factory.name,
        support_email: this.cfg.factory.support_email || '(not configured — never invent one; create a chore)',
        locales: this.cfg.factory.locales.join(', '),
        primary_locale: this.cfg.factory.primary_locale,
        bundle_id_prefix: this.cfg.factory.bundle_id_prefix,
      },
      paths: { home: this.paths.root, plugin: this.paths.plugin, factory: this.paths.factory, ledger: this.paths.ledger, learnings: this.paths.learnings, cards: this.paths.cards, reports: this.paths.reports, portfolio: this.paths.portfolio, proposals: this.paths.proposals },
      autonomy: this.cfg.autonomy,
      stores: this.cfg.stores,
      lanes_enabled: enabledLanes.join(', '),
      critic_enabled: this.cfg.critic.enabled ? 'yes — run `sedef critic`' : 'no — use the evaluator subagent with the critique rubric',
      ledger_recent: this.recentLedger(),
      recent_ideas: Object.values(this.state.ideas).slice(-40).map((i) => `${i.title} [${i.lane}, ${i.status}]`).join('\n') || '(none yet)',
      portfolio: Object.values(this.state.products).map((p) => `${p.slug} · ${p.lane} · stage=${p.stage} · status=${p.status} · spend=$${p.spend_usd.toFixed(0)} · launched=${p.launched_at ?? '-'}`).join('\n') || '(no products yet)',
      ideas_per_scout: this.cfg.autonomy.ideas_per_scout,
    };
  }

  // ---------------------------------------------------------- product stage

  private async runProductStage(slug: string, stageName: string, ctrl: AbortController, budgetUsd: number): Promise<void> {
    const def = this.pipeline.stages[stageName]!;
    await this.ensureLaneTemplate(slug, stageName);
    const attempt = this.mutate((s) => {
      const p = s.products[slug]!;
      p.status = 'running';
      p.attempts[stageName] = (p.attempts[stageName] ?? 0) + 1;
      addEvent(p, stageName, 'start', `deneme ${p.attempts[stageName]}`);
      return p.attempts[stageName]!;
    });
    const product = this.state.products[slug]!;
    const cwd = product.dir;
    const now0 = new Date();
    const feedbackFile = path.join(cwd, '.sedef', 'feedback', `${stageName}.md`);
    const vars = this.promptVars(def, attempt, attempt > 1 ? readText(feedbackFile) : '', product);
    const mission = render(readText(path.join(this.paths.prompts, def.prompt)), vars);
    prepareStageFiles(cwd, def, attempt);
    const ctxBase = { cwd, home: os.homedir() };
    const isImmutable = (abs: string) => matchesAny(abs, def.immutable, ctxBase) !== undefined;
    const snap = snapshotFiles(cwd, def.immutable, walkFiles, isImmutable);
    const mcp = buildMcpServers(this.catalog, def.mcp, process.env);
    if (mcp.skipped.length) this.log(`[${slug}/${stageName}] MCP skipped: ${mcp.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`);
    const escalations: Escalation[] = [];
    const env = this.sessionEnv(def, product);
    const logFile = path.join(this.paths.sessions, localParts(now0, this.tz).date, `${slug}-${stageName}-${now0.getTime()}.jsonl`);

    const outcome = await runSession({
      title: `${slug} · ${stageName} #${attempt}`,
      cwd,
      prompt: `Run the "${stageName}" stage for product "${slug}" now. Follow the stage mission in your system prompt. Work autonomously; there is no human in this session.`,
      mission,
      model: modelFor(def.model, this.cfg),
      fallbackModel: this.cfg.models.fallback,
      ...(def.effort ? { effort: def.effort } : {}),
      maxTurns: def.max_turns,
      budgetUsd: budgetUsd,
      timeoutMs: def.timeout_minutes * 60_000,
      tools: stageTools(def),
      disallowedTools: def.tools.deny,
      mcpServers: mcp.servers,
      env,
      pluginDir: this.paths.plugin,
      additionalDirectories: [this.paths.learnings, this.paths.templates],
      ...(def.sandbox ? { sandbox: def.sandbox } : {}),
      ...(this.apiKeyHelper() ? { apiKeyHelper: this.apiKeyHelper()! } : {}),
      policy: { ctx: this.policyContext(def, cwd, product), cfg: this.policy },
      ...(def.stop_gate ? { stopGate: { command: def.stop_gate.command, maxNudges: def.stop_gate.max_nudges, timeoutSeconds: def.stop_gate.timeout_seconds } } : {}),
      logFile,
      signal: ctrl.signal,
      onEscalate: (e) => escalations.push(e),
    });

    const tampered = restoreSnapshot(snap, cwd, walkFiles, isImmutable);
    recordSpend(this.paths.spend, { at: nowIso(), product: slug, stage: stageName, ...(outcome.sessionId ? { session_id: outcome.sessionId } : {}), cost_usd: outcome.costUsd, turns: outcome.turns, outcome: outcome.subtype });
    this.releaseReservation(`product:${slug}`);
    this.mutate((s) => { s.products[slug]!.spend_usd += outcome.costUsd; });
    this.log(`[${slug}/${stageName}] session ${outcome.subtype} · $${outcome.costUsd.toFixed(2)} · ${outcome.turns} turns · ${outcome.denials} denials${outcome.error ? ' · ' + outcome.error : ''}`);

    if (this.stopping || (ctrl.signal.aborted && !outcome.timedOut) || outcome.accountError) {
      // Not the product's fault: give the attempt back.
      this.mutate((s) => {
        const p = s.products[slug]!;
        p.status = 'ready';
        p.attempts[stageName] = Math.max(0, attempt - 1);
        addEvent(p, stageName, 'interrupted', outcome.accountError);
      });
      if (outcome.accountError) await this.pauseForAccount(outcome.accountError);
      return;
    }

    // Outage, overload or no network: back off and try again without burning the attempt (bounded).
    if (!outcome.ok && outcome.apiError && TRANSIENT_API_ERRORS.has(outcome.apiError)) {
      const n = (product.api_failures ?? 0) + 1;
      const wait = apiBackoffMinutes(n);
      this.mutate((s) => { s.products[slug]!.api_failures = n; });
      if (wait !== undefined) {
        this.mutate((s) => {
          const p = s.products[slug]!;
          p.status = 'waiting';
          p.wait_until = addMinutes(new Date(), wait).toISOString();
          p.attempts[stageName] = Math.max(0, attempt - 1);
          addEvent(p, stageName, 'api_error', `${outcome.apiError} · ${wait} dk sonra`);
        });
        this.log(`[${slug}/${stageName}] transient API error (${outcome.apiError}) #${n} — retry in ${wait} min, attempt not counted`);
        if (n === 2) await this.notify(`🌐 <b>${htmlEscape(slug)}</b>: API/bağlantı art arda ${n} kez düştü (<code>${htmlEscape(outcome.apiError)}</code>). Mac’in internetini ve status.anthropic.com’u kontrol et; ürün kendiliğinden tekrar denenecek.`);
        return;
      }
    } else if (product.api_failures) {
      this.mutate((s) => { delete s.products[slug]!.api_failures; });
    }

    const newChores = this.ingestChores(slug, cwd, escalations);

    // ---- verification (deterministic, outside the agent's reach)
    const failures: string[] = [];
    if (tampered.length) failures.push(`Protected verifier/contract files were modified and have been restored: ${tampered.join(', ')}. Never edit them; report problems in .sedef/verifier-issues.md.`);
    const fieldValue = def.route ? stringValue(getField(readJson<unknown>(path.join(cwd, def.route.file), undefined), def.route.field)) : undefined;
    if (!failures.length) {
      const v = await runChecks(def.verify, cwd, { env: { ...process.env, ...env }, novelty: () => this.noveltyFor(cwd, slug) });
      failures.push(...v.failures);
      // A session that didn't finish cleanly never passes on what earlier runs left behind — unless it reports
      // an irreversible outward action (a submission), which a re-run would only repeat. Build is judged by
      // measurable progress instead: a phase finished before the turn limit still counts.
      const irreversible = fieldValue !== undefined && def.irreversible.includes(fieldValue);
      if (!outcome.ok && !def.progress && !irreversible) failures.push(`the session did not finish cleanly (${outcome.subtype}${outcome.error ? `: ${outcome.error}` : ''}) — complete the whole mission within the turn and budget limits`);
    }
    const passedChecks = failures.length === 0;

    // ---- routing
    const now = new Date();
    let decision: RouteDecision | undefined;
    const progressValue = def.progress ? Number(getField(readJson<unknown>(path.join(cwd, def.progress.file), undefined), def.progress.field)) : undefined;
    const prevProgress = product.progress?.[stageName];
    const noProgress = `no measurable progress this session: ${def.progress?.file} → ${def.progress?.field} is ${Number.isFinite(progressValue) ? progressValue : 'missing'} (needs to exceed ${prevProgress ?? 0}). Finish exactly one phase and have the evaluator record it.`;
    const routeError = passedChecks ? routeValueError(def, fieldValue) : undefined;
    if (routeError) {
      // For a looping stage the missing progress is the real problem (the evaluator didn't record a phase).
      failures.push(def.progress && !progressOk(progressValue ?? Number.NaN, prevProgress) ? noProgress : routeError);
    } else if (passedChecks) {
      decision = resolveAfterPass(stageName, def, this.pipeline.stages, fieldValue, now, product.self_loops ?? 0);
      if (def.progress && decision.stage === stageName && !progressOk(progressValue ?? Number.NaN, prevProgress)) {
        failures.push(noProgress);
        decision = undefined;
      }
    }
    const passed = failures.length === 0;
    let replanned = false;
    if (passed && decision) {
      decision = await this.postPass(stageName, slug, cwd, decision, now);
      try { fs.rmSync(feedbackFile, { force: true }); } catch { /* ignore */ }
    } else {
      writeFileAtomic(feedbackFile, `# Why the previous "${stageName}" attempt did not pass (${nowIso()})\n\n${failures.map((f) => `- ${f}`).join('\n')}\n\nSession outcome: ${outcome.subtype}${outcome.error ? ` (${outcome.error})` : ''}.\n`);
      decision = resolveAfterFail(stageName, def, attempt, product.replans, this.cfg.autonomy.max_replans);
      replanned = decision.reason === 'exhausted→replan';
    }
    decision = this.applyEscalationRouting(decision, escalations, slug, now);
    const finalDecision = decision;

    await commitAll(cwd, `chore(sedef): ${stageName} session #${attempt} (${passed ? 'pass' : 'retry'})`).catch((e) => this.log(`[${slug}] commit failed: ${(e as Error).message}`));
    await pushIfRemote(cwd).catch(() => undefined);

    const before = this.state.products[slug]!.stage;
    let selfLoopChore: Chore | undefined;
    // Entering a looping stage (build) from elsewhere: record the progress baseline it must beat.
    const enteringDef = this.pipeline.stages[finalDecision.stage];
    const baseline = enteringDef?.progress && finalDecision.stage !== stageName
      ? Number(getField(readJson<unknown>(path.join(cwd, enteringDef.progress.file), undefined), enteringDef.progress.field))
      : undefined;
    this.mutate((s) => {
      const p = s.products[slug]!;
      if (replanned) p.replans += 1;
      if (passed) p.attempts[stageName] = 0;
      if (passed && progressValue !== undefined && Number.isFinite(progressValue)) p.progress = { ...(p.progress ?? {}), [stageName]: progressValue };
      if (baseline !== undefined) p.progress = { ...(p.progress ?? {}), [finalDecision.stage]: Number.isFinite(baseline) ? baseline : 0 };
      if (finalDecision.reason === 'self-loop backoff') p.self_loops = (p.self_loops ?? 0) + 1;
      else if (passed) delete p.self_loops;
      p.stage = finalDecision.stage;
      p.status = finalDecision.status;
      if (finalDecision.wait_until) p.wait_until = finalDecision.wait_until; else delete p.wait_until;
      if ((p.self_loops ?? 0) >= MAX_SELF_LOOPS) {
        // It keeps saying "waiting for a human" but nothing is asked of the human: stop paying for re-checks.
        p.status = 'blocked';
        delete p.wait_until;
        selfLoopChore = upsertChore(s, {
          key: `self-loop:${stageName}`,
          kind: 'decision',
          title: `${stageTr(stageName)} ${p.self_loops} kez üst üste "insan bekleniyor" dedi`,
          instructions: `Senden istenen açık bir iş görünmüyor. Ürünün .sedef/notes.md, STATUS.md ve .sedef/release.json dosyalarına bak; gerekeni yap, sonra "devam". Durdurmak için /oldur ${slug}.`,
          minutes: 5,
          blocking: true,
          options: ['devam'],
          actions: { devam: { goto: stageName } },
        }, slug);
      }
      if (finalDecision.stage !== before) {
        p.attempts[finalDecision.stage] = 0;
        addEvent(p, finalDecision.stage, finalDecision.stage === 'killed' ? 'killed' : 'advance', `${stageTr(before)} → ${stageTr(finalDecision.stage)}`);
        if (CYCLE_RESET_STAGES.has(finalDecision.stage)) p.visits = {};
        const visits = (p.visits?.[finalDecision.stage] ?? 0) + 1;
        p.visits = { ...(p.visits ?? {}), [finalDecision.stage]: visits };
        if (visits > MAX_STAGE_VISITS && !TERMINAL_STAGES.has(finalDecision.stage)) {
          p.status = 'failed';
          p.last_error = `${stageTr(finalDecision.stage)} bu sürüm döngüsünde ${visits}. kez açılacaktı (${stageTr(before)} ile gidip geliyor) — döngü şüphesiyle park edildi`;
          addEvent(p, finalDecision.stage, 'parked', p.last_error);
        }
      } else if (!passed) {
        addEvent(p, stageName, finalDecision.status === 'failed' ? 'parked' : 'retry', truncate(failures[0] ?? outcome.subtype, 200));
      }
      if (!passed) p.last_error = truncate(failures[0] ?? outcome.subtype, 300);
      if (pendingChores(s, slug).some((c) => c.blocking) && (p.status === 'ready' || p.status === 'waiting')) p.status = 'blocked';
    });

    const p = this.state.products[slug]!;
    if (p.stage === 'killed' && before !== 'killed') await this.notify(`🪦 <b>${htmlEscape(slug)}</b> durduruldu (${stageTr(before)}). Gerekçe: ${htmlEscape(readReason(cwd))}`);
    if (p.status === 'failed') await this.notify(`🧯 <b>${htmlEscape(slug)}</b> ${stageTr(p.stage)} aşamasında park edildi: ${htmlEscape(p.last_error ?? '')}`);
    const blocking = [...newChores.filter((c) => c.blocking), ...(selfLoopChore ? [selfLoopChore] : [])];
    if (blocking.length) await this.notify(`🔑 <b>${htmlEscape(slug)}</b> senden ${blocking.length} iş bekliyor:\n\n${blocking.map(formatChore).join('\n\n')}`);
  }

  /** Every stage after validation needs the lane's verifier; apply the template if a path skipped it (e.g. a human kill-override). */
  private async ensureLaneTemplate(slug: string, stageName: string): Promise<void> {
    if (stageName === 'validate') return;
    const p = this.state.products[slug]!;
    if (!LANE_TEMPLATES[p.lane] || fs.existsSync(path.join(p.dir, '.sedef', 'lane.md'))) return;
    const created = await applyLaneTemplate(this.paths, this.cfg, p.dir, slug, p.title, p.lane, process.env);
    if (created.length) this.log(`[${slug}] lane template ${p.lane} applied late: ${created.length} files`);
  }

  /** Stage-specific bookkeeping after a pass; may adjust the route. */
  private async postPass(stageName: string, slug: string, cwd: string, decision: RouteDecision, now: Date): Promise<RouteDecision> {
    const product = this.state.products[slug]!;
    if (stageName === 'validate') {
      const verdict = readJson<{ decision?: string; lane?: string; title?: string; reason_tr?: string }>(path.join(cwd, '.sedef', 'verdict.json'), {});
      if (verdict.lane && verdict.lane !== product.lane) this.mutate((s) => { s.products[slug]!.lane = verdict.lane!; });
      if (verdict.title) this.mutate((s) => { s.products[slug]!.title = verdict.title!; });
      if (decision.stage === 'killed' && product.source === 'human') {
        // The human proposed this idea: don't kill it silently.
        this.mutate((s) => upsertChore(s, {
          key: 'validate-kill-override',
          kind: 'decision',
          title: 'Doğrulama bu fikrin yapılmamasını öneriyor',
          instructions: `Gerekçe: ${verdict.reason_tr ?? 'bkz. .sedef/brief.md'}. Yine de üretelim mi?`,
          minutes: 2,
          blocking: true,
          options: ['devam', 'oldur'],
          actions: { devam: { goto: 'spec' }, oldur: { goto: 'killed' } },
        }, slug));
        return { stage: 'validate', status: 'blocked', reason: 'human idea kill needs confirmation' };
      }
      if (decision.stage !== 'killed') {
        const lane = this.state.products[slug]!.lane;
        const created = await applyLaneTemplate(this.paths, this.cfg, cwd, slug, this.state.products[slug]!.title, lane, process.env);
        if (created.length) this.log(`[${slug}] lane template ${lane}: ${created.length} files`);
      }
    }
    if (stageName === 'spec' && decision.stage === 'brand' && product.replans > 0 && designIsDone(cwd)) {
      // A re-plan after build got stuck: the brand and screens stay; go straight back to building.
      return { stage: 'build', status: 'ready', reason: 'replan→build' };
    }
    if (stageName === 'brand') {
      const fp = readJson<Fingerprint | undefined>(path.join(cwd, '.sedef', 'fingerprint.json'), undefined);
      if (fp) {
        const rows = readJsonl<Fingerprint>(this.paths.ledger).filter((r) => r.product !== slug);
        rows.push({ ...fp, product: slug, created_at: nowIso() });
        writeFileAtomic(this.paths.ledger, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      }
      // The brand stage names the product for real; later missions and messages use that name.
      const verdict = readJson<{ title?: string }>(path.join(cwd, '.sedef', 'verdict.json'), {});
      if (verdict.title && verdict.title !== product.title) {
        this.mutate((s) => { const p = s.products[slug]!; addEvent(p, 'brand', 'renamed', `${p.title} → ${verdict.title}`); p.title = verdict.title!; });
      }
      if (product.lane === 'ios') {
        const where = wireIosAppIcon(cwd);
        if (where) this.log(`[${slug}] app icon wired into ${where}`);
      }
    }
    if (stageName === 'release' || stageName === 'review_fix') {
      const relFile = path.join(cwd, '.sedef', 'release.json');
      const rel = readJson<{ status?: string; store?: string; kind?: 'new' | 'update'; app_id?: string; version?: string }>(relFile, {});
      if (rel.app_id) this.mutate((s) => { s.products[slug]!.app_ids[rel.store ?? 'apple'] = rel.app_id!; });
      if (rel.status === 'submitted') {
        this.mutate((s) => {
          s.submissions.push({ at: nowIso(), product: slug, store: rel.store ?? 'apple', kind: stageName === 'review_fix' ? 'resubmission' : (rel.kind ?? 'new') });
          s.products[slug]!.submissions += 1;
        });
        writeJsonAtomic(relFile, { ...rel, status: 'recorded', recorded_at: nowIso() });
        archiveRejection(cwd);
      }
    }
    if (stageName === 'release_watch' && decision.stage === 'launch') {
      await this.notify(`🎉 <b>${htmlEscape(slug)}</b> mağaza incelemesinden geçti. Lansman başlıyor.`);
    }
    if (stageName === 'release_watch' && decision.stage === 'review_fix') {
      await this.notify(`📮 <b>${htmlEscape(slug)}</b> incelemeden döndü; düzeltme aşamasına alındı.`);
    }
    if (stageName === 'launch') {
      this.mutate((s) => {
        const p = s.products[slug]!;
        p.launched_at = nowIso();
        addEvent(p, 'launch', 'launched', 'yayında 🚀');
      });
      await this.notify(`🚀 <b>${htmlEscape(slug)}</b> yayında. İlk büyüme turu bir hafta sonra.`);
    }
    void now;
    return decision;
  }

  /** Escalations that change routing (submission cap → wait; first submission → ask). */
  private applyEscalationRouting(decision: RouteDecision, escalations: Escalation[], slug: string, now: Date): RouteDecision {
    if (escalations.some((e) => e.kind === 'submission_cap')) {
      const windowed = [...submissionsInWindow(this.state, 'apple', 'new', now), ...submissionsInWindow(this.state, 'google', 'new', now)]
        .map((s) => Date.parse(s.at)).sort((a, b) => a - b);
      const reopen = windowed.length ? new Date(windowed[0]! + 30 * 86_400_000 + 3600_000) : new Date(now.getTime() + 86_400_000);
      return { stage: this.state.products[slug]!.stage === 'release' ? 'release' : decision.stage, status: 'waiting', wait_until: reopen.toISOString(), reason: 'submission cap' };
    }
    if (escalations.some((e) => e.kind === 'first_submission')) {
      this.mutate((s) => upsertChore(s, {
        key: 'first-submission',
        kind: 'decision',
        title: 'İlk mağaza gönderimi için onay',
        instructions: 'Tüm otomatik kapılar geçti (QA, uyum, mağaza görselleri). Gönderelim mi? Detay: .sedef/qa-report.md, .sedef/compliance.json',
        minutes: 3,
        blocking: true,
        options: ['gonder', 'bekle'],
        actions: { gonder: { approve: 'first_submission', goto: 'release' }, bekle: {} },
      }, slug));
      return { stage: 'release', status: 'blocked', reason: 'first submission approval' };
    }
    return decision;
  }

  private ingestChores(slug: string | undefined, cwd: string, escalations: Escalation[]): Chore[] {
    const consumed = slug ? consumeProductChores(cwd) : { inputs: [], rejected: [] };
    if (consumed.rejected.length) this.log(`[${slug}] ${consumed.rejected.length} chore entr${consumed.rejected.length === 1 ? 'y' : 'ies'} without a title ignored (kept in .sedef/chores-history.json)`);
    const inputs: ChoreInput[] = consumed.inputs;
    for (const e of escalations) {
      if (e.kind === 'submission_cap' || e.kind === 'first_submission') continue;
      inputs.push({
        key: `escalation:${e.kind}:${truncate(String(e.input.command ?? e.tool), 80)}`,
        kind: e.kind,
        title: 'Bir ajan insan onayı gerektiren bir adıma takıldı',
        instructions: `Araç: ${e.tool}\nİstek: ${truncate(String(e.input.command ?? JSON.stringify(e.input)), 400)}\nNeden: ${e.reason}\nGerekirse elle yap, sonra /tamam ile kapat.`,
        minutes: 5,
        blocking: false,
      });
    }
    const created: Chore[] = [];
    this.mutate((s) => {
      for (const input of inputs) {
        const c = upsertChore(s, input, slug);
        if (c) created.push(c);
      }
    });
    return created;
  }

  // ---------------------------------------------------------- factory stage

  private async runFactoryStage(stageName: string, ctrl: AbortController, budgetUsd: number): Promise<void> {
    const def = this.pipeline.stages[stageName]!;
    const cwd = this.paths.factory;
    for (const d of [this.paths.cards, this.paths.reports, this.paths.learnings, this.paths.portfolio, this.paths.proposals]) ensureDir(d);
    const now0 = new Date();
    const mission = render(readText(path.join(this.paths.prompts, def.prompt)), this.promptVars(def, 1, ''));
    const mcp = buildMcpServers(this.catalog, def.mcp, process.env);
    const escalations: Escalation[] = [];
    const logFile = path.join(this.paths.sessions, localParts(now0, this.tz).date, `factory-${stageName}-${now0.getTime()}.jsonl`);
    const outcome = await runSession({
      title: `factory · ${stageName}`,
      cwd,
      prompt: `Run the factory "${stageName}" job now. Follow the mission in your system prompt. There is no human in this session.`,
      mission,
      model: modelFor(def.model, this.cfg),
      fallbackModel: this.cfg.models.fallback,
      ...(def.effort ? { effort: def.effort } : {}),
      maxTurns: def.max_turns,
      budgetUsd: budgetUsd,
      timeoutMs: def.timeout_minutes * 60_000,
      tools: stageTools(def),
      disallowedTools: def.tools.deny,
      mcpServers: mcp.servers,
      env: this.sessionEnv(def),
      pluginDir: this.paths.plugin,
      additionalDirectories: [expandHome(this.cfg.factory.products_dir)],
      ...(def.sandbox ? { sandbox: def.sandbox } : {}),
      ...(this.apiKeyHelper() ? { apiKeyHelper: this.apiKeyHelper()! } : {}),
      policy: { ctx: this.policyContext(def, cwd), cfg: this.policy },
      logFile,
      signal: ctrl.signal,
      onEscalate: (e) => escalations.push(e),
    });
    recordSpend(this.paths.spend, { at: nowIso(), stage: stageName, ...(outcome.sessionId ? { session_id: outcome.sessionId } : {}), cost_usd: outcome.costUsd, turns: outcome.turns, outcome: outcome.subtype });
    this.releaseReservation(`factory:${stageName}`);
    this.log(`[factory/${stageName}] ${outcome.subtype} · $${outcome.costUsd.toFixed(2)}${outcome.error ? ' · ' + outcome.error : ''}`);
    if (outcome.accountError) { await this.pauseForAccount(outcome.accountError); return; }
    if (this.stopping || ctrl.signal.aborted) return;
    if (!outcome.ok && outcome.apiError && TRANSIENT_API_ERRORS.has(outcome.apiError)) {
      this.factoryHold.set(stageName, Date.now() + 30 * 60_000);
      this.log(`[factory/${stageName}] transient API error (${outcome.apiError}) — retrying in 30 min`);
      return;
    }
    this.ingestChores(undefined, cwd, escalations);
    const today = localParts(new Date(), this.tz).date;
    if (stageName === 'scout') {
      this.mutate((s) => { s.schedule.last_scout_date = today; });
      await this.ingestCards();
    } else if (stageName === 'portfolio') {
      this.mutate((s) => { s.schedule.last_portfolio_date = today; });
      await this.applyPortfolioDecisions(today);
    } else if (stageName === 'retro') {
      this.mutate((s) => { s.schedule.last_retro_date = today; });
      const proposals = fs.existsSync(this.paths.proposals) ? fs.readdirSync(this.paths.proposals).filter((f) => f.endsWith('.md') && !f.startsWith('applied-')) : [];
      if (proposals.length) await this.notify(`🧠 Retro: ${proposals.length} skill iyileştirme önerisi hazır (factory/proposals). Uygulamak için: <code>sedef proposals apply</code>`);
    }
  }

  async ingestCards(): Promise<void> {
    ensureDir(this.paths.cards);
    const known = new Set(Object.values(this.state.ideas).map((i) => i.card_path));
    const files = fs.readdirSync(this.paths.cards).filter((f) => f.endsWith('.json')).map((f) => path.join(this.paths.cards, f)).filter((f) => !known.has(f));
    for (const file of files) {
      const card = readJson<IdeaCard>(file, {});
      if (!card.title) continue;
      const idea = this.mutate((s) => {
        const id = nextId(s, 'i');
        const i: Idea = {
          id,
          title: truncate(card.title!, 80),
          summary_tr: card.summary_tr ?? card.one_liner ?? '',
          lane: card.lane ?? 'auto',
          score: Number(card.score) || 0,
          card_path: file,
          source: 'scout',
          status: 'pending',
          created_at: nowIso(),
        };
        s.ideas[id] = i;
        return i;
      });
      if (this.cfg.autonomy.idea_gate === 'auto' && idea.score >= this.cfg.autonomy.idea_auto_threshold) {
        await this.approveIdea(idea.id, 'otomatik (skor eşiği)');
        continue;
      }
      const msgId = await this.notify(ideaCardHtml(idea, card), { buttons: [[{ text: '✅ Üret', data: `i:ok:${idea.id}` }, { text: '❌ Geç', data: `i:no:${idea.id}` }]] });
      if (msgId) this.mutate((s) => { s.ideas[idea.id]!.telegram_message_id = msgId; });
    }
  }

  async approveIdea(id: string, by = 'sen'): Promise<string | undefined> {
    const idea = this.state.ideas[id];
    if (!idea || idea.status !== 'pending') return undefined;
    const slug = uniqueSlug(this.state, slugify(idea.title), expandHome(this.cfg.factory.products_dir));
    this.mutate((s) => { const i = s.ideas[id]!; i.status = 'approved'; i.decided_at = nowIso(); i.product = slug; });
    const dir = await scaffoldProduct(this.paths, this.cfg, idea, slug, process.env);
    this.mutate((s) => {
      const now = nowIso();
      const p: Product = {
        slug,
        title: idea.title,
        lane: idea.lane,
        idea_id: id,
        source: idea.source,
        stage: 'validate',
        status: 'ready',
        attempts: {},
        replans: 0,
        created_at: now,
        updated_at: now,
        dir,
        spend_usd: 0,
        submissions: 0,
        approvals: [],
        app_ids: {},
        events: [],
      };
      addEvent(p, 'validate', 'advance', `fikir onaylandı (${by}) → Doğrulama`);
      s.products[slug] = p;
    });
    if (idea.telegram_message_id && this.tg) await this.tg.clearButtons(idea.telegram_message_id);
    await this.notify(`✅ <b>${htmlEscape(slug)}</b> üretim hattına girdi (${htmlEscape(LANE_TR[idea.lane] ?? idea.lane)}).`, { urgent: true });
    return slug;
  }

  private async applyPortfolioDecisions(today: string): Promise<void> {
    const file = path.join(this.paths.portfolio, 'decisions.json');
    const data = readJson<{ decisions?: { product: string; action: string; reason?: string }[]; summary_tr?: string }>(file, {});
    for (const d of data.decisions ?? []) {
      const p = this.state.products[d.product];
      if (!p) continue;
      this.mutate((s) => {
        const x = s.products[d.product]!;
        if (d.action === 'sunset') { x.stage = 'sunset'; x.status = 'done'; addEvent(x, 'sunset', 'advance', `portföy: emekliye ayrıldı — ${d.reason ?? ''}`); }
        else if ((d.action === 'iterate' || d.action === 'double_down') && x.stage === 'grow') { x.status = 'ready'; delete x.wait_until; addEvent(x, 'grow', 'advance', `portföy: ${d.action} — ${d.reason ?? ''}`); }
        else if (d.action === 'unpark' && x.status === 'failed') { x.status = 'ready'; x.attempts[x.stage] = 0; x.visits = {}; delete x.self_loops; addEvent(x, x.stage, 'advance', `portföy: yeniden denensin — ${d.reason ?? ''}`); }
        else if (d.action === 'kill' && !TERMINAL_STAGES.has(x.stage)) { x.stage = 'killed'; x.status = 'done'; addEvent(x, 'killed', 'killed', `portföy: durduruldu — ${d.reason ?? ''}`); }
      });
    }
    if (fs.existsSync(file)) fs.renameSync(file, path.join(this.paths.portfolio, `decisions-${today}.json`));
    if (data.summary_tr) await this.notify(`📊 <b>Haftalık portföy</b>\n${htmlEscape(truncate(data.summary_tr, 3000))}`);
  }

  private expireIdeas(now: Date): void {
    const ttl = this.cfg.autonomy.idea_ttl_days * 86_400_000;
    const expired = Object.values(this.state.ideas).filter((i) => i.status === 'pending' && now.getTime() - Date.parse(i.created_at) > ttl);
    if (!expired.length) return;
    this.mutate((s) => { for (const i of expired) { s.ideas[i.id]!.status = 'expired'; s.ideas[i.id]!.decided_at = nowIso(); } });
    for (const i of expired) if (i.telegram_message_id && this.tg) void this.tg.clearButtons(i.telegram_message_id);
  }

  private async sendDigest(now: Date, spend: SpendTotals): Promise<void> {
    const text = dailyDigest(this.state, spend, this.cfg, this.state.schedule.last_digest_at, now);
    this.mutate((s) => {
      s.schedule.last_digest_date = localParts(now, this.tz).date;
      s.schedule.last_digest_at = now.toISOString();
      for (const c of s.chores) if (!c.done_at) c.notified = true;
    });
    await this.notify(text, { urgent: true });
  }

  // --------------------------------------------------------------- telegram

  private async telegramLoop(): Promise<void> {
    while (!this.stopping) {
      const started = Date.now();
      const updates = await this.tg!.poll(this.state.telegram.offset, 25);
      for (const u of updates) {
        this.mutate((s) => { s.telegram.offset = Math.max(s.telegram.offset, u.update_id + 1); });
        try { await this.handleUpdate(u); } catch (err) { this.log(`telegram update failed: ${(err as Error).message}`); }
      }
      if (!updates.length && Date.now() - started < 2000) await sleep(5000, this.stop.signal);
    }
  }

  private async handleUpdate(u: TgUpdate): Promise<void> {
    const tg = this.tg!;
    if (u.callback_query) {
      const q = u.callback_query;
      if (!tg.isAllowed(q.from, q.message?.chat.id)) { await tg.answerCallback(q.id, 'Yetkin yok'); return; }
      const [kind, a, b] = (q.data ?? '').split(':');
      if (kind === 'i' && a === 'ok' && b) {
        const slug = await this.approveIdea(b);
        await tg.answerCallback(q.id, slug ? `Üretime alındı: ${slug}` : 'Bu fikir artık beklemede değil');
      } else if (kind === 'i' && a === 'no' && b) {
        const idea = this.state.ideas[b];
        if (idea?.status === 'pending') this.mutate((s) => { s.ideas[b]!.status = 'rejected'; s.ideas[b]!.decided_at = nowIso(); });
        if (q.message) await tg.clearButtons(q.message.message_id);
        await tg.answerCallback(q.id, 'Geçildi');
      } else if (kind === 'c' && a) {
        const ok = await this.finishChore(a, b);
        await tg.answerCallback(q.id, ok ? 'Tamam' : 'Bulunamadı');
      }
      return;
    }
    const m = u.message;
    if (!m?.text || !tg.isAllowed(m.from, m.chat.id)) return;
    const [rawCmd, ...rest] = m.text.trim().split(/\s+/);
    const cmd = (rawCmd ?? '').replace(/@.*$/, '').toLowerCase();
    const arg = rest.join(' ');
    await this.handleCommand(cmd, arg, rest);
  }

  async handleCommand(cmd: string, arg: string, parts: string[]): Promise<string> {
    const reply = async (html: string) => { await this.notify(html, { urgent: true }); return html; };
    const spend = () => loadSpend(this.paths.spend, new Date(), this.tz);
    switch (cmd) {
      case '/durum':
      case '/status':
        return reply(statusSummary(this.state, spend(), this.cfg));
      case '/dur':
      case '/pause':
        this.mutate((s) => { s.paused = true; if (arg) s.pause_reason = arg; });
        for (const c of this.running.values()) c.abort();
        return reply('⏸ Fabrika durduruldu; çalışan oturumlar kesildi. Devam için /devam');
      case '/devam':
      case '/resume':
        this.mutate((s) => { s.paused = false; delete s.pause_reason; });
        return reply('▶️ Fabrika yeniden çalışıyor.');
      case '/fikir':
      case '/idea': {
        if (!arg.trim()) return reply('Kullanım: /fikir &lt;fikrin, birkaç cümle&gt;');
        const idea = this.addHumanIdea(arg.trim());
        const slug = await this.approveIdea(idea.id, 'sen');
        return slug ? `ok:${slug}` : 'failed';
      }
      case '/isler':
      case '/chores': {
        const list = pendingChores(this.state);
        return reply(list.length ? `🔑 <b>Bekleyen işler</b>\n\n${list.map(formatChore).join('\n\n')}` : 'Bekleyen iş yok 🎉');
      }
      case '/tamam':
      case '/done': {
        const [id, choice] = parts;
        if (!id) return reply('Kullanım: /tamam &lt;iş-id&gt; [seçenek]');
        const ok = await this.finishChore(id, choice);
        return reply(ok ? `✔︎ ${htmlEscape(id)} kapatıldı.` : `${htmlEscape(id)} bulunamadı ya da seçenek geçersiz.`);
      }
      case '/red':
      case '/rejection': {
        const [slug, ...textParts] = parts;
        const p = slug ? this.state.products[slug] : undefined;
        if (!p || !textParts.length) return reply('Kullanım: /red &lt;ürün&gt; &lt;App Review mesajının metni&gt;');
        // rejection.md always holds the rejection to fix now; earlier ones live in rejections.md.
        writeFileAtomic(path.join(p.dir, '.sedef', 'rejection.md'), `# App Review rejection — received ${nowIso()}\n\n${textParts.join(' ')}\n`);
        this.mutate((s) => {
          for (const c of s.chores) if (c.product === slug && c.key === 'rejection-text' && !c.done_at) c.done_at = nowIso();
          const x = s.products[slug]!;
          x.stage = 'review_fix';
          x.status = 'ready';
          x.attempts.review_fix = 0;
          delete x.wait_until;
          addEvent(x, 'review_fix', 'advance', 'red metni alındı → Red düzeltme');
        });
        return reply(`📮 ${htmlEscape(slug!)}: red metni kaydedildi, düzeltme başlıyor.`);
      }
      case '/oldur':
      case '/kill': {
        const slug = parts[0];
        if (!slug || !this.state.products[slug]) return reply('Kullanım: /oldur &lt;ürün&gt;');
        this.running.get(`product:${slug}`)?.abort();
        this.mutate((s) => { const x = s.products[slug]!; x.stage = 'killed'; x.status = 'done'; addEvent(x, 'killed', 'killed', 'elle durduruldu'); });
        return reply(`🪦 ${htmlEscape(slug)} durduruldu.`);
      }
      case '/butce':
      case '/budget': {
        const t = spend();
        const top = Object.entries(t.byProduct).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `• ${htmlEscape(k)}: $${v.toFixed(2)}`).join('\n');
        return reply(`💸 Bugün $${t.today.toFixed(2)} / $${this.cfg.budgets_usd.daily} · Bu ay $${t.month.toFixed(2)} / $${this.cfg.budgets_usd.monthly}\n${top}`);
      }
      case '/onayla':
      case '/approve': {
        const slug = parts[0] ? await this.approveIdea(parts[0]) : undefined;
        return reply(slug ? `✅ ${htmlEscape(slug)} üretime alındı.` : 'Kullanım: /onayla &lt;fikir-id&gt; (bekleyen bir fikir olmalı)');
      }
      case '/gec':
      case '/reject': {
        const idea = parts[0] ? this.state.ideas[parts[0]] : undefined;
        if (!idea || idea.status !== 'pending') return reply('Kullanım: /gec &lt;fikir-id&gt;');
        this.mutate((s) => { s.ideas[idea.id]!.status = 'rejected'; s.ideas[idea.id]!.decided_at = nowIso(); });
        if (idea.telegram_message_id && this.tg) await this.tg.clearButtons(idea.telegram_message_id);
        return reply(`❌ ${htmlEscape(idea.id)} geçildi.`);
      }
      case '/calistir':
      case '/run': {
        const [slug, stage] = parts;
        try { await this.runNow(slug ?? '', stage ?? ''); } catch (err) { return reply(htmlEscape((err as Error).message)); }
        return reply(`▶️ ${htmlEscape(slug!)} → ${stageTr(stage!)} sıraya alındı.`);
      }
      case '/oneriler':
      case '/proposals': {
        const list = listProposals(this.paths);
        return reply(list.length ? `🧠 <b>Skill önerileri</b>\n${list.map((f, i) => `${i + 1}. ${htmlEscape(f)}`).join('\n')}\nUygulamak için: /uygula &lt;no&gt;` : 'Bekleyen öneri yok.');
      }
      case '/uygula':
      case '/apply': {
        const list = listProposals(this.paths);
        const pick = list[Number(parts[0]) - 1] ?? parts[0];
        if (!pick) return reply('Kullanım: /uygula &lt;no&gt;');
        const res = await applyProposal(this.paths, pick);
        return reply(`${res.ok ? '✔︎' : '✖︎'} ${htmlEscape(res.message)}`);
      }
      default:
        return reply([
          '🦪 <b>Sedef komutları</b>',
          '/durum — ürünler, harcama, bekleyenler',
          '/fikir &lt;metin&gt; — kendi fikrini doğrudan hatta sok',
          '/isler — senden beklenen işler',
          '/tamam &lt;id&gt; [seçenek] — bir işi kapat',
          '/red &lt;ürün&gt; &lt;metin&gt; — App Review red mesajını yapıştır',
          '/oldur &lt;ürün&gt; — bir ürünü durdur',
          '/onayla · /gec &lt;fikir-id&gt; — fikir kararı (butonların yazılı hali)',
          '/oneriler · /uygula &lt;no&gt; — retro skill önerileri',
          '/dur · /devam — acil durdurma / devam',
          '/butce — harcama özeti',
        ].join('\n'));
    }
  }

  addHumanIdea(text: string): Idea {
    ensureDir(this.paths.cards);
    return this.mutate((s) => {
      const id = nextId(s, 'i');
      const title = truncate(text.split(/[.\n!?]/)[0]!.trim() || text, 60);
      const file = path.join(this.paths.cards, `${localParts(new Date(), this.tz).date}-${id}-human.json`);
      writeJsonAtomic(file, { title, one_liner: text, summary_tr: text, lane: 'auto', source: 'human' });
      const idea: Idea = { id, title, summary_tr: text, lane: 'auto', score: 0, card_path: file, source: 'human', status: 'pending', created_at: nowIso() };
      s.ideas[id] = idea;
      return idea;
    });
  }

  async finishChore(id: string, choice?: string): Promise<boolean> {
    const chore = this.mutate((s) => completeChore(s, id, choice));
    if (!chore) return false;
    const action = chore.choice ? chore.actions?.[chore.choice] : chore.actions?.done;
    if (chore.product) {
      this.mutate((s) => {
        const p = s.products[chore.product!];
        if (!p) return;
        if (action?.approve && !p.approvals.includes(action.approve)) p.approvals.push(action.approve);
        if (action?.goto) {
          p.stage = action.goto;
          p.status = TERMINAL_STAGES.has(action.goto) ? 'done' : 'ready';
          p.attempts[action.goto] = 0;
          p.visits = {};
          delete p.self_loops;
          delete p.wait_until;
          addEvent(p, action.goto, action.goto === 'killed' ? 'killed' : 'advance', `senin kararın → ${stageTr(action.goto)}`);
        }
        const stillBlocked = pendingChores(s, p.slug).some((c) => c.blocking);
        if (p.status === 'blocked' && !stillBlocked) p.status = 'ready';
        // A stage that was backing off while it waited for this answer can go now.
        if (p.status === 'waiting' && chore.blocking && !stillBlocked) { p.status = 'ready'; delete p.wait_until; }
      });
      const p = this.state.products[chore.product];
      if (p) {
        try { recordChoreAnswer(p.dir, chore); } catch (err) { this.log(`[${p.slug}] could not record chore answer: ${(err as Error).message}`); }
      }
    }
    return true;
  }

  // ------------------------------------------------------------- utilities

  async runNow(slug: string, stage: string): Promise<void> {
    if (!this.state.products[slug]) throw new Error(`unknown product ${slug}`);
    if (!this.pipeline.stages[stage]) throw new Error(`unknown stage ${stage}`);
    this.mutate((s) => {
      const p = s.products[slug]!;
      p.stage = stage;
      p.status = 'ready';
      p.attempts[stage] = 0;
      p.visits = {};
      delete p.wait_until;
      addEvent(p, stage, 'advance', 'elle başlatıldı');
    });
  }
}

/**
 * Before each attempt: move the stage's verdict files aside, and on the first attempt of a visit blank the
 * route field of a stateful route file (release.json, progress.json) — only this session's answer may route.
 */
export function prepareStageFiles(cwd: string, def: StageDef, attempt: number): void {
  for (const rel of def.reset) {
    const file = path.join(cwd, rel);
    if (!fs.existsSync(file)) continue;
    const ext = path.extname(rel);
    const prev = path.join(cwd, ext ? `${rel.slice(0, -ext.length)}.prev${ext}` : `${rel}.prev`);
    try { fs.renameSync(file, prev); } catch { /* leave it; verification will judge */ }
  }
  if (attempt === 1 && def.route && !def.reset.includes(def.route.file)) {
    const file = path.join(cwd, def.route.file);
    const data = readJson<unknown>(file, undefined);
    if (data && typeof data === 'object' && !Array.isArray(data) && getField(data, def.route.field) !== undefined) {
      if (setField(data as Record<string, unknown>, def.route.field, null)) writeJsonAtomic(file, data);
    }
  }
}

/** Brand and design already passed for this product (DESIGN.md plus a passing design critique). */
export function designIsDone(cwd: string): boolean {
  if (!fs.existsSync(path.join(cwd, 'DESIGN.md'))) return false;
  return readJson<{ verdict?: string }>(path.join(cwd, 'design', 'critique.json'), {}).verdict === 'pass';
}

/** Hosts the product itself deployed to (any https URL in release.json / launch.json). */
export function ownHosts(cwd: string): string[] {
  const hosts = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      const m = /^https:\/\/([^/\s?#:]+)/i.exec(v.trim());
      if (m && !m[1]!.endsWith('.invalid')) hosts.add(m[1]!.toLowerCase());
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of ['release.json', 'launch.json']) walk(readJson<unknown>(path.join(cwd, '.sedef', f), undefined));
  return [...hosts];
}

/** After a (re)submission the current rejection is history; a later rejection must bring its own text. */
export function archiveRejection(cwd: string): void {
  const cur = path.join(cwd, '.sedef', 'rejection.md');
  if (!fs.existsSync(cur)) return;
  fs.appendFileSync(path.join(cwd, '.sedef', 'rejections.md'), `\n\n---\n\n${readText(cur).trim()}\n\n(archived after the submission of ${nowIso()})\n`);
  fs.rmSync(cur, { force: true });
}

/** iOS: put the brand icon into the app's AppIcon set (single 1024 universal icon) so no build ships without one. */
export function wireIosAppIcon(cwd: string): string | undefined {
  const icon = path.join(cwd, 'design', 'brand', 'icon-1024.png');
  if (!fs.existsSync(icon)) return undefined;
  const sets = walkFiles(cwd)
    .filter((f) => f.endsWith(`AppIcon.appiconset${path.sep}Contents.json`) && !/Tests?[/\\]/.test(f))
    .map((f) => path.dirname(f));
  const dir = sets[0];
  if (!dir) return undefined;
  fs.copyFileSync(icon, path.join(dir, 'icon-1024.png'));
  writeJsonAtomic(path.join(dir, 'Contents.json'), {
    images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  });
  return path.relative(cwd, dir);
}

function ensureLogs(dir: string): string {
  ensureDir(dir);
  return dir;
}

function stringValue(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function readReason(cwd: string): string {
  const v = readJson<{ reason_tr?: string; reason?: string }>(path.join(cwd, '.sedef', 'verdict.json'), {});
  return truncate(v.reason_tr ?? v.reason ?? 'bkz. .sedef/brief.md', 400);
}

export function ideaCardHtml(idea: Idea, card: IdeaCard): string {
  const e = htmlEscape;
  return [
    `💡 <b>${e(idea.title)}</b>`,
    `${e(LANE_TR[idea.lane] ?? idea.lane)} · skor ${idea.score.toFixed(1)}/5 · ${idea.id}`,
    '',
    e(card.summary_tr ?? card.one_liner ?? ''),
    card.why_now ? `\n⏱ <i>Neden şimdi:</i> ${e(card.why_now)}` : '',
    card.wedge ? `🎯 <i>Kama:</i> ${e(card.wedge)}` : '',
    card.monetization ? `💰 <i>Gelir:</i> ${e(card.monetization)}` : '',
    card.distribution ? `📣 <i>İlk 100 kullanıcı:</i> ${e(card.distribution)}` : '',
  ].filter(Boolean).join('\n');
}
