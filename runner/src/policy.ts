/**
 * Sedef policy engine — answers every permission prompt instead of the human.
 *
 * Deterministic and side-effect free (except `checkToolLimit`, which counts),
 * so it is unit-tested and auditable. Three outcomes:
 *   allow     → the tool runs
 *   deny      → the tool is blocked; the agent is told why
 *   escalate  → blocked now, and a human chore is queued (weekly batch)
 */
import os from 'node:os';
import path from 'node:path';
import type { BashRule, PolicyConfig, WebAccess } from './config.js';
import { expandHome } from './paths.js';
import { globToRegExp } from './util.js';

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'escalate'; reason: string; kind: string };

export interface PolicyFlags {
  appleWebAutomation: boolean;
  /** False once the product has an app in the store: updates and resubmissions are not new-app submissions. */
  isNewApp: boolean;
  submissionsLeft: number;
  firstSubmissionNeedsHuman: boolean;
  firstSubmissionApproved: boolean;
}

export interface PolicyContext {
  stage: string;
  cwd: string;
  home: string;
  agentType?: string;
  writableRoots: string[];
  immutable: string[];
  /** Absolute globs the foreman protects at runtime (its own config, runner, plugin, state). */
  protectedWrite: string[];
  mcpAllowed: string[] | '*';
  web: WebAccess;
  flags: PolicyFlags;
  /** The product's own deployed hosts (from release.json / launch.json): always fetchable and browsable. */
  ownHosts?: string[];
}

const allow: PolicyDecision = { decision: 'allow' };
const deny = (reason: string): PolicyDecision => ({ decision: 'deny', reason });

/** Resolve a path argument the way the tool would (relative to cwd, ~ expanded). */
export function resolveToolPath(p: string, ctx: Pick<PolicyContext, 'cwd' | 'home'>): string {
  const expanded = expandHome(p, ctx.home);
  return path.normalize(path.isAbsolute(expanded) ? expanded : path.resolve(ctx.cwd, expanded));
}

/** Make a policy glob absolute: "~/x" → home, "/x" stays, "**\/x" stays, "x" → cwd/x. */
export function absGlob(glob: string, ctx: Pick<PolicyContext, 'cwd' | 'home'>): string {
  if (glob.startsWith('~')) return expandHome(glob, ctx.home);
  if (glob.startsWith('/') || glob.startsWith('**')) return glob;
  return path.join(ctx.cwd, glob);
}

export function matchesAny(absPath: string, globs: string[], ctx: Pick<PolicyContext, 'cwd' | 'home'>): string | undefined {
  for (const g of globs) {
    const abs = absGlob(g, ctx);
    const re = globToRegExp(abs);
    if (re.test(absPath)) return g;
    // A pattern like "dir/**" should also cover the directory itself.
    if (abs.endsWith('/**') && absPath === abs.slice(0, -3)) return g;
  }
  return undefined;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Literal prefixes of protected globs, used to catch shell commands that touch them. */
export function protectedFragments(globs: string[], home: string): string[] {
  const frags = new Set<string>();
  for (const g of globs) {
    if (!(g.startsWith('~') || g.startsWith('/'))) continue;
    const cut = g.search(/[*?]/);
    const literal = (cut === -1 ? g : g.slice(0, cut)).replace(/\/+$/, '');
    if (literal.length < 3) continue;
    frags.add(literal);
    if (literal.startsWith('~')) frags.add(expandHome(literal, home));
    if (literal.startsWith(home)) frags.add('~' + literal.slice(home.length));
    frags.add(literal.replace(/^~/, '$HOME'));
  }
  return [...frags];
}

function stringArg(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith('mcp__')) return undefined;
  const rest = tool.slice(5);
  const i = rest.indexOf('__');
  return i === -1 ? rest : rest.slice(0, i);
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).hostname.toLowerCase(); } catch { return undefined; }
}

/** Directories that hold protected files: the literal, glob-free prefix of every ~ or / anchored protected glob. */
export function protectedRoots(globs: string[], home: string): string[] {
  const roots = new Set<string>();
  for (const g of globs) {
    if (!(g.startsWith('~') || g.startsWith('/'))) continue;
    const cut = g.search(/[*?[{]/);
    const literal = (cut === -1 ? g : g.slice(0, cut)).replace(/\/+$/, '');
    if (literal.length > 1) roots.add(path.normalize(expandHome(literal, home)));
  }
  return [...roots];
}

/**
 * Read, Glob and Grep. A recursive search (Glob/Grep) rooted at a directory that *contains* a protected
 * location (e.g. Grep in ~ or ~/.sedef) would read protected files without naming them, so it is refused too.
 */
function checkRead(tool: string, input: Record<string, unknown>, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  const recursive = tool === 'Glob' || tool === 'Grep' || tool === 'LS';
  const targets: string[] = [];
  const p = stringArg(input, 'file_path') ?? stringArg(input, 'path') ?? stringArg(input, 'notebook_path');
  if (p) targets.push(p);
  else if (recursive) targets.push(ctx.cwd);
  const pattern = tool === 'Glob' ? stringArg(input, 'pattern') : undefined;
  if (pattern && (pattern.startsWith('/') || pattern.startsWith('~'))) {
    const cut = pattern.search(/[*?[{]/);
    let prefix = cut === -1 ? pattern : pattern.slice(0, cut);
    // "~/.s*" searches the whole home folder, not a folder called ".s".
    if (cut !== -1 && !prefix.endsWith('/')) prefix = path.dirname(prefix);
    targets.push(prefix || '/');
  }
  for (const t of targets) {
    const abs = resolveToolPath(t, ctx);
    const hit = matchesAny(abs, cfg.protected_paths, ctx);
    if (hit) return deny(`protected path (${hit}) — secrets and credentials are never readable by agents`);
    if (!recursive) continue;
    const inside = protectedRoots(cfg.protected_paths, ctx.home).find((root) => root !== abs && isInside(root, abs));
    if (inside) return deny(`${tool} over ${abs} would reach a protected location (${inside}); search a narrower folder (the product, the factory or /tmp)`);
  }
  return allow;
}

/**
 * Plugin agents arrive as "sedef:evaluator"; accept that and the bare spelling alike.
 * Agents from other namespaces ("other:evaluator") keep their own name only.
 */
export function agentNames(agentType: string | undefined): string[] {
  if (!agentType) return [];
  if (agentType.startsWith('sedef:')) return [agentType, agentType.slice(6)];
  if (!agentType.includes(':')) return [agentType, `sedef:${agentType}`];
  return [agentType];
}

function checkWrite(p: string, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  const abs = resolveToolPath(p, ctx);
  const prot = matchesAny(abs, cfg.protected_paths, ctx) ?? matchesAny(abs, cfg.protected_write_paths, ctx) ?? matchesAny(abs, ctx.protectedWrite, ctx);
  if (prot) return deny(`write to protected path (${prot}) is not allowed — factory code, config, skills and state change only through proposals`);
  const imm = matchesAny(abs, ctx.immutable, ctx);
  if (imm) return deny(`"${imm}" is a verifier/contract file and is immutable during stage "${ctx.stage}". If it is wrong, explain why in .sedef/verifier-issues.md instead.`);
  const names = agentNames(ctx.agentType);
  for (const [glob, rule] of Object.entries(cfg.agent_only_writes)) {
    if (rule.stages && !rule.stages.includes(ctx.stage)) continue;
    if (matchesAny(abs, [glob], ctx) && !names.some((n) => rule.agents.includes(n))) {
      return deny(`only ${rule.agents.join(', ')} may write ${glob} during "${ctx.stage}" — ask that subagent to verify and record the result`);
    }
  }
  const scopeKey = names.find((n) => cfg.agent_write_scope[n]);
  const scope = scopeKey ? cfg.agent_write_scope[scopeKey] : undefined;
  if (scope && !matchesAny(abs, scope, ctx)) {
    return deny(`${ctx.agentType} may only write ${scope.join(', ')} — report findings; the main session changes product code`);
  }
  if (!ctx.writableRoots.some((root) => isInside(abs, root))) {
    return deny(`writes are limited to ${ctx.writableRoots.join(', ')} in stage "${ctx.stage}"`);
  }
  return allow;
}

function ruleApplies(rule: BashRule, cmd: string, stage: string): boolean {
  if (rule.stages && !rule.stages.includes(stage)) return false;
  return new RegExp(rule.re).test(cmd);
}

function checkBash(cmd: string, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  // Also test a flattened spelling so quote/backslash splitting ("sec""urity", .e\nv) doesn't slip past.
  const flat = cmd.replace(/["'\\]/g, '');
  const forms = flat === cmd ? [cmd] : [cmd, flat];
  for (const rule of cfg.bash.deny) if (forms.some((c) => ruleApplies(rule, c, ctx.stage))) return deny(rule.reason);
  for (const frag of protectedFragments(cfg.protected_paths, ctx.home)) {
    if (forms.some((c) => c.includes(frag))) return deny(`command references a protected location (${frag})`);
  }
  for (const rule of cfg.bash.escalate) {
    if (!ruleApplies(rule, cmd, ctx.stage)) continue;
    switch (rule.kind ?? 'generic') {
      case 'apple_web':
        if (ctx.flags.appleWebAutomation) continue;
        return { decision: 'escalate', reason: rule.reason, kind: 'apple_web' };
      case 'store_submission_new':
        if (!ctx.flags.isNewApp) continue; // updates and resubmissions of an app already in the store
        if (ctx.flags.submissionsLeft <= 0) {
          return { decision: 'escalate', reason: 'store submission cap for the rolling 30-day window is reached; the product will wait for the window to reopen', kind: 'submission_cap' };
        }
        if (ctx.flags.firstSubmissionNeedsHuman && !ctx.flags.firstSubmissionApproved) {
          return { decision: 'escalate', reason: 'first store submission of this product needs a human go-ahead (autonomy.first_submission_needs_human)', kind: 'first_submission' };
        }
        continue;
      default:
        return { decision: 'escalate', reason: rule.reason, kind: rule.kind ?? 'generic' };
    }
  }
  return allow;
}

function checkWeb(tool: string, input: Record<string, unknown>, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  if (ctx.web === 'none') return deny(`web access is disabled in stage "${ctx.stage}"`);
  if (tool === 'WebSearch' || ctx.web === 'open') return allow;
  const host = hostOf(stringArg(input, 'url') ?? '');
  if (!host) return deny('WebFetch without a valid URL');
  const ok = cfg.docs_domains.some((d) => host === d || host.endsWith('.' + d)) || (ctx.ownHosts ?? []).includes(host);
  return ok ? allow : deny(`stage "${ctx.stage}" may only fetch documentation domains (${host} is not on the list)`);
}

/** Browser tools that open a URL follow the stage's web access like WebFetch does; local pages are always fine. */
const BROWSER_URL_TOOLS: Record<string, string> = { mcp__playwright__browser_navigate: 'url' };

function checkBrowserUrl(url: string | undefined, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  if (ctx.web === 'open') return allow;
  if (!url) return deny('browser navigation without a URL');
  let u: URL;
  try { u = new URL(url); } catch { return deny(`browser navigation to an invalid URL (${url})`); }
  if (u.protocol === 'file:' || u.protocol === 'about:' || u.protocol === 'data:') return allow;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) || host.endsWith('.localhost')) return allow;
  if ((ctx.ownHosts ?? []).includes(host)) return allow;
  if (ctx.web === 'docs' && cfg.docs_domains.some((d) => host === d || host.endsWith('.' + d))) return allow;
  return deny(`stage "${ctx.stage}" may browse local pages${ctx.web === 'docs' ? ' and documentation domains' : ''} only (${host})`);
}

export function evaluate(tool: string, input: Record<string, unknown>, ctx: PolicyContext, cfg: PolicyConfig): PolicyDecision {
  const denied = cfg.deny_tools[tool];
  if (denied) return deny(denied);
  if (cfg.always_allow_tools.includes(tool)) return allow;

  if (cfg.read_tools.includes(tool)) return checkRead(tool, input, ctx, cfg);
  if (cfg.write_tools.includes(tool)) {
    const p = stringArg(input, 'file_path') ?? stringArg(input, 'notebook_path');
    return p ? checkWrite(p, ctx, cfg) : deny('write tool without a path');
  }
  if (tool === 'Bash') {
    const cmd = stringArg(input, 'command');
    return cmd ? checkBash(cmd, ctx, cfg) : allow;
  }
  if (tool === 'WebFetch' || tool === 'WebSearch') return checkWeb(tool, input, ctx, cfg);

  const server = mcpServerOf(tool);
  if (server !== undefined) {
    if (!(ctx.mcpAllowed === '*' || ctx.mcpAllowed.includes(server))) return deny(`MCP server "${server}" is not enabled for stage "${ctx.stage}"`);
    const urlParam = BROWSER_URL_TOOLS[tool];
    return urlParam ? checkBrowserUrl(stringArg(input, urlParam), ctx, cfg) : allow;
  }

  return cfg.unknown_tool === 'allow' ? allow : deny(`tool ${tool} is not on the allow list`);
}

/** Per-session caps for expensive tools (e.g. paid image generation). Counts on allow. */
export function checkToolLimit(tool: string, counts: Map<string, number>, cfg: PolicyConfig): PolicyDecision {
  for (const [pattern, limit] of Object.entries(cfg.tool_limits)) {
    const matches = pattern.endsWith('*') ? tool.startsWith(pattern.slice(0, -1)) : tool === pattern;
    if (!matches) continue;
    const used = counts.get(pattern) ?? 0;
    if (used >= limit) return deny(`per-session limit reached for ${pattern} (${limit}). Work with what you have or record the need in .sedef/notes.md.`);
    counts.set(pattern, used + 1);
  }
  return allow;
}

/** A permissive context for humans using Claude Code interactively (secrets + destructive commands still blocked). */
export function interactiveContext(cwd: string): PolicyContext {
  return {
    stage: 'interactive',
    cwd,
    home: os.homedir(),
    writableRoots: ['/'],
    immutable: [],
    protectedWrite: [],
    mcpAllowed: '*',
    web: 'open',
    flags: { appleWebAutomation: true, isNewApp: false, submissionsLeft: Number.POSITIVE_INFINITY, firstSubmissionNeedsHuman: false, firstSubmissionApproved: true },
  };
}
