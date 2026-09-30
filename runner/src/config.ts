import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Paths } from './paths.js';

// ---------------------------------------------------------------------------
// sedef.config.yaml
// ---------------------------------------------------------------------------

export interface SedefConfig {
  factory: {
    name: string;
    timezone: string;
    products_dir: string;
    github_owner: string;
    support_email: string;
    bundle_id_prefix: string;
    primary_locale: string;
    locales: string[];
  };
  autonomy: {
    idea_gate: 'required' | 'auto';
    idea_auto_threshold: number;
    max_pending_ideas: number;
    idea_ttl_days: number;
    ideas_per_scout: number;
    max_new_store_submissions_per_30d: number;
    first_submission_needs_human: boolean;
    apple_web_session_automation: boolean;
    max_replans: number;
  };
  concurrency: { max_parallel_sessions: number; max_active_products: number };
  schedules: {
    heartbeat_seconds: number;
    scout: string;
    digest: string;
    portfolio_review: string;
    retro: string;
    quiet_hours: [string, string] | [];
  };
  budgets_usd: {
    daily: number;
    monthly: number;
    per_product_to_launch: number;
    per_session_default: number;
    ads_daily: number;
  };
  models: { strategist: string; lead: string; worker: string; fast: string; fallback: string };
  auth: { mode: 'keychain' | 'env' | 'oauth'; keychain_service: string; keychain_account: string };
  critic: { enabled: boolean; provider: 'gemini' | 'openai'; model: string };
  lanes: Record<string, { enabled: boolean; template_repo?: string }>;
  notify: { telegram: boolean; language: 'tr' | 'en' };
  stores: {
    apple: { account_type: 'individual' | 'organization' };
    google: { account_type: 'personal' | 'organization' };
  };
  novelty: {
    threshold: number;
    window: number;
    font_window: number;
    palette_min_delta_e: number;
    weights: Record<string, number>;
  };
}

export const DEFAULT_CONFIG: SedefConfig = {
  factory: {
    name: 'sedef',
    timezone: 'Europe/Istanbul',
    products_dir: '~/sedef-products',
    github_owner: '',
    support_email: '',
    bundle_id_prefix: 'com.example.sedef',
    primary_locale: 'en-US',
    locales: ['en-US', 'tr'],
  },
  autonomy: {
    idea_gate: 'required',
    idea_auto_threshold: 4.2,
    max_pending_ideas: 6,
    idea_ttl_days: 7,
    ideas_per_scout: 3,
    max_new_store_submissions_per_30d: 2,
    first_submission_needs_human: false,
    apple_web_session_automation: false,
    max_replans: 2,
  },
  concurrency: { max_parallel_sessions: 2, max_active_products: 3 },
  schedules: {
    heartbeat_seconds: 120,
    scout: '08:30',
    digest: '21:00',
    portfolio_review: 'sun 10:00',
    retro: 'sun 11:30',
    quiet_hours: ['00:30', '08:00'],
  },
  budgets_usd: { daily: 60, monthly: 1200, per_product_to_launch: 300, per_session_default: 12, ads_daily: 0 },
  models: {
    strategist: 'claude-fable-5-1',
    lead: 'claude-opus-5-5',
    worker: 'claude-sonnet-5-5',
    fast: 'claude-haiku-4-5-20251001',
    fallback: 'claude-opus-5-5',
  },
  auth: { mode: 'keychain', keychain_service: 'sedef-anthropic-api-key', keychain_account: 'sedef' },
  critic: { enabled: false, provider: 'gemini', model: '' },
  lanes: {
    ios: { enabled: true },
    expo_dual: { enabled: true },
    web_saas: { enabled: true },
    chrome_extension: { enabled: true },
    mac_direct: { enabled: false },
    apify_actor: { enabled: false },
    figma_plugin: { enabled: false },
    digital_assets: { enabled: false },
  },
  notify: { telegram: true, language: 'tr' },
  stores: { apple: { account_type: 'organization' }, google: { account_type: 'organization' } },
  novelty: {
    threshold: 0.45,
    window: 12,
    font_window: 6,
    palette_min_delta_e: 0.08,
    weights: {
      direction: 1,
      palette: 1.5,
      fonts: 1.2,
      icon_style: 0.8,
      name_pattern: 0.5,
      category: 0.6,
      core_mechanic: 0.6,
    },
  },
};

// ---------------------------------------------------------------------------
// pipeline.yaml
// ---------------------------------------------------------------------------

export type ModelTier = 'strategist' | 'lead' | 'worker' | 'fast';
export type WebAccess = 'open' | 'docs' | 'none';

export type VerifyCheck =
  | { kind: 'files_exist'; paths: string[] }
  | { kind: 'command'; run: string; timeout_seconds?: number }
  | { kind: 'json_field'; file: string; field: string; one_of: string[] }
  | { kind: 'novelty' };

export interface StageDef {
  name: string;
  scope: 'product' | 'factory';
  model: ModelTier;
  prompt: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  tools: { allow: string[]; deny: string[] };
  mcp: string[];
  web: WebAccess;
  secrets: string[];
  sandbox?: Record<string, unknown>;
  max_turns: number;
  budget_usd: number;
  timeout_minutes: number;
  verify: VerifyCheck[];
  stop_gate?: { command: string; max_nudges: number; timeout_seconds: number };
  route?: { file: string; field: string; map: Record<string, string>; default?: string };
  next?: string;
  max_attempts: number;
  on_exhausted: string; // park | kill | goto:<stage>
  enter_delay_minutes?: number;
  poll_minutes?: number;
  immutable: string[];
  writable_extra: string[];
  /** Counts toward concurrency.max_active_products (false for review/launch/grow stages). */
  wip: boolean;
  /** A numeric field that must increase when the stage loops onto itself (e.g. phases_done). */
  progress?: { file: string; field: string };
  /**
   * Verdict files this stage must write afresh: before every attempt they are moved aside to
   * `<name>.prev<ext>` (still readable for context), so a leftover from an earlier run can never pass.
   */
  reset: string[];
  /**
   * Route values that report an outward, irreversible action (a store submission, a production deploy).
   * They count even if the session ended early — re-running would repeat the action.
   */
  irreversible: string[];
}

export interface PipelineConfig {
  stages: Record<string, StageDef>;
  order: string[];
  factory_stages: string[];
}

export const TERMINAL_STAGES = new Set(['killed', 'sunset']);

// ---------------------------------------------------------------------------
// policy.yaml
// ---------------------------------------------------------------------------

export interface BashRule {
  re: string;
  reason: string;
  stages?: string[];
  kind?: 'generic' | 'store_submission_new' | 'apple_web' | 'spend';
}

export interface PolicyConfig {
  unknown_tool: 'allow' | 'deny';
  always_allow_tools: string[];
  deny_tools: Record<string, string>;
  read_tools: string[];
  write_tools: string[];
  protected_paths: string[];
  protected_write_paths: string[];
  agent_only_writes: Record<string, { agents: string[]; stages?: string[] }>;
  /** Subagents that may only write inside these globs (relative to the session cwd). */
  agent_write_scope: Record<string, string[]>;
  docs_domains: string[];
  bash: { deny: BashRule[]; escalate: BashRule[] };
  tool_limits: Record<string, number>;
}

// ---------------------------------------------------------------------------
// mcp.json
// ---------------------------------------------------------------------------

export interface McpCatalogEntry {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  description?: string;
  auth?: 'none' | 'key' | 'oauth';
}

export type McpCatalog = Record<string, McpCatalogEntry>;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : (override as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function loadYamlFile(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`Missing config file: ${file}`);
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot parse ${path.basename(file)}: ${(err as Error).message}`);
  }
}

export function loadConfig(paths: Paths): SedefConfig {
  const raw = loadYamlFile(paths.config);
  const cfg = deepMerge(DEFAULT_CONFIG, raw ?? {});
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg: SedefConfig): void {
  const errs: string[] = [];
  try { new Intl.DateTimeFormat('en-GB', { timeZone: cfg.factory.timezone }); } catch { errs.push(`factory.timezone is not a valid IANA zone: ${cfg.factory.timezone}`); }
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const weekly = /^(sun|mon|tue|wed|thu|fri|sat) ([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(cfg.schedules.scout)) errs.push('schedules.scout must be HH:MM');
  if (!hhmm.test(cfg.schedules.digest)) errs.push('schedules.digest must be HH:MM');
  if (!weekly.test(cfg.schedules.portfolio_review)) errs.push('schedules.portfolio_review must look like "sun 10:00"');
  if (!weekly.test(cfg.schedules.retro)) errs.push('schedules.retro must look like "sun 11:30"');
  if (cfg.schedules.quiet_hours.length && !cfg.schedules.quiet_hours.every((t) => hhmm.test(t))) errs.push('schedules.quiet_hours must be [] or ["HH:MM","HH:MM"]');
  for (const [k, v] of Object.entries(cfg.budgets_usd)) if (typeof v !== 'number' || v < 0) errs.push(`budgets_usd.${k} must be a non-negative number`);
  if (cfg.concurrency.max_parallel_sessions < 1) errs.push('concurrency.max_parallel_sessions must be >= 1');
  if (!['keychain', 'env', 'oauth'].includes(cfg.auth.mode)) errs.push('auth.mode must be keychain | env | oauth');
  if (cfg.critic.enabled && !cfg.critic.model) errs.push('critic.model is required when critic.enabled is true');
  if (errs.length) throw new Error('Invalid sedef.config.yaml:\n  - ' + errs.join('\n  - '));
}

const STAGE_DEFAULTS: Omit<StageDef, 'name' | 'prompt'> = {
  scope: 'product',
  model: 'lead',
  tools: { allow: [], deny: [] },
  mcp: [],
  web: 'none',
  secrets: [],
  max_turns: 150,
  budget_usd: 10,
  timeout_minutes: 90,
  verify: [],
  max_attempts: 2,
  on_exhausted: 'park',
  immutable: [],
  writable_extra: [],
  reset: [],
  irreversible: [],
  wip: true,
};

export function loadPipeline(paths: Paths): PipelineConfig {
  const raw = loadYamlFile(paths.pipeline);
  if (!isPlainObject(raw) || !isPlainObject(raw.stages)) throw new Error('pipeline.yaml must contain a "stages" mapping');
  const stages: Record<string, StageDef> = {};
  for (const [name, def] of Object.entries(raw.stages)) {
    if (!isPlainObject(def)) throw new Error(`pipeline.yaml: stage ${name} must be a mapping`);
    const merged = deepMerge({ ...STAGE_DEFAULTS, name, prompt: `${name}.md` } as StageDef, def);
    merged.name = name;
    stages[name] = merged;
  }
  const pipeline: PipelineConfig = {
    stages,
    order: Object.keys(stages),
    factory_stages: Object.values(stages).filter((s) => s.scope === 'factory').map((s) => s.name),
  };
  validatePipeline(pipeline, paths);
  return pipeline;
}

export function validatePipeline(p: PipelineConfig, paths?: Paths): void {
  const errs: string[] = [];
  const known = (t: string) => t in p.stages || TERMINAL_STAGES.has(t);
  for (const s of Object.values(p.stages)) {
    if (!['strategist', 'lead', 'worker', 'fast'].includes(s.model)) errs.push(`${s.name}: unknown model tier ${s.model}`);
    if (!['open', 'docs', 'none'].includes(s.web)) errs.push(`${s.name}: web must be open | docs | none`);
    if (s.next && !known(s.next)) errs.push(`${s.name}: next → unknown stage ${s.next}`);
    if (s.route) for (const t of Object.values(s.route.map)) if (!known(t)) errs.push(`${s.name}: route → unknown stage ${t}`);
    if (s.route?.default && !known(s.route.default)) errs.push(`${s.name}: route.default → unknown stage ${s.route.default}`);
    const ex = s.on_exhausted;
    if (!(ex === 'park' || ex === 'kill' || (ex.startsWith('goto:') && known(ex.slice(5))))) errs.push(`${s.name}: bad on_exhausted ${ex}`);
    if (paths && !fs.existsSync(path.join(paths.prompts, s.prompt))) errs.push(`${s.name}: prompt file not found prompts/stages/${s.prompt}`);
    for (const c of s.verify) {
      if (!['files_exist', 'command', 'json_field', 'novelty'].includes(c.kind)) errs.push(`${s.name}: unknown verify kind ${(c as { kind: string }).kind}`);
    }
    if (!Array.isArray(s.reset) || s.reset.some((r) => typeof r !== 'string' || r.includes('*') || path.isAbsolute(r) || r.includes('..'))) {
      errs.push(`${s.name}: reset must list plain relative file paths`);
    }
    if (!Array.isArray(s.irreversible) || (s.irreversible.length && !s.route)) errs.push(`${s.name}: irreversible needs a route and must be a list`);
    else for (const v of s.irreversible) if (!s.route || !Object.hasOwn(s.route.map, v)) errs.push(`${s.name}: irreversible value "${v}" is not a route value`);
  }
  if (errs.length) throw new Error('Invalid pipeline.yaml:\n  - ' + errs.join('\n  - '));
}

export function loadPolicy(paths: Paths): PolicyConfig {
  const raw = loadYamlFile(paths.policy) as Partial<PolicyConfig>;
  const cfg: PolicyConfig = {
    unknown_tool: raw.unknown_tool ?? 'allow',
    always_allow_tools: raw.always_allow_tools ?? [],
    deny_tools: raw.deny_tools ?? {},
    read_tools: raw.read_tools ?? ['Read', 'Glob', 'Grep', 'LS'],
    write_tools: raw.write_tools ?? ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
    protected_paths: raw.protected_paths ?? [],
    protected_write_paths: raw.protected_write_paths ?? [],
    agent_only_writes: raw.agent_only_writes ?? {},
    agent_write_scope: raw.agent_write_scope ?? {},
    docs_domains: raw.docs_domains ?? [],
    bash: { deny: raw.bash?.deny ?? [], escalate: raw.bash?.escalate ?? [] },
    tool_limits: raw.tool_limits ?? {},
  };
  for (const r of [...cfg.bash.deny, ...cfg.bash.escalate]) {
    try { new RegExp(r.re); } catch (err) { throw new Error(`policy.yaml: invalid regex ${r.re}: ${(err as Error).message}`); }
  }
  return cfg;
}

export function loadMcpCatalog(paths: Paths): McpCatalog {
  if (!fs.existsSync(paths.mcp)) return {};
  const raw = JSON.parse(fs.readFileSync(paths.mcp, 'utf8')) as { mcpServers?: McpCatalog };
  return raw.mcpServers ?? {};
}

export function modelFor(tier: ModelTier, cfg: SedefConfig): string {
  return cfg.models[tier];
}
