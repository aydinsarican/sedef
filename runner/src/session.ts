/**
 * One agent session = one fresh context working on one unit of work.
 * The foreman owns everything durable; this module only runs the SDK loop,
 * enforces policy on every tool call and records a compact transcript.
 */
import { query, type CanUseTool, type HookCallback, type McpServerConfig, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PolicyConfig } from './config.js';
import { checkToolLimit, evaluate, type PolicyContext, type PolicyDecision } from './policy.js';
import { appendJsonl, nowIso, runCommand, tail, truncate } from './util.js';

export interface Escalation {
  tool: string;
  reason: string;
  kind: string;
  input: Record<string, unknown>;
}

export interface SessionRequest {
  title: string;
  cwd: string;
  prompt: string;
  mission: string;
  model: string;
  fallbackModel?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns: number;
  budgetUsd: number;
  timeoutMs: number;
  /** Built-in tools that exist in this session (availability, not approval — the policy approves each call). */
  tools: string[];
  disallowedTools: string[];
  mcpServers: Record<string, McpServerConfig>;
  env: Record<string, string>;
  pluginDir: string;
  additionalDirectories: string[];
  sandbox?: Record<string, unknown>;
  apiKeyHelper?: string;
  policy: { ctx: PolicyContext; cfg: PolicyConfig };
  stopGate?: { command: string; maxNudges: number; timeoutSeconds: number };
  logFile: string;
  signal: AbortSignal;
  onEscalate: (e: Escalation) => void;
}

export interface SessionOutcome {
  ok: boolean;
  subtype: string;
  costUsd: number;
  turns: number;
  sessionId?: string;
  error?: string;
  denials: number;
  resultText?: string;
  timedOut: boolean;
  /** Set when the API refused the account or key — retrying cannot help; the foreman pauses the factory. */
  accountError?: string;
  /** The last API error the session ended with after the SDK's own retries (server_error, overloaded, unknown = network, …). */
  apiError?: string;
}

/** API errors worth retrying later without holding it against the product (outage, overload, no network). */
export const TRANSIENT_API_ERRORS = new Set(['server_error', 'overloaded', 'rate_limit', 'unknown']);

/**
 * API errors that no retry fixes: the SDK would otherwise back off for minutes (401 is retried up to 10 times)
 * and every queued product would burn an attempt on the same broken key.
 */
export const ACCOUNT_ERRORS = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error', 'cloud_credential_error',
]);

type Block = { type: string; text?: string; name?: string; input?: unknown };

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const pick = o.command ?? o.file_path ?? o.url ?? o.pattern ?? o.query ?? o.description ?? o.prompt;
  return truncate(typeof pick === 'string' ? pick : JSON.stringify(o), 240);
}

export async function runSession(req: SessionRequest): Promise<SessionOutcome> {
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort();
  req.signal.addEventListener('abort', onExternalAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort.abort(); }, req.timeoutMs);
  const counts = new Map<string, number>();
  const log = (row: Record<string, unknown>) => appendJsonl(req.logFile, { at: nowIso(), ...row });
  let denials = 0;
  let nudges = 0;

  const decide = (tool: string, input: Record<string, unknown>, agentType: string | undefined, count: boolean): PolicyDecision => {
    const ctx: PolicyContext = agentType ? { ...req.policy.ctx, agentType } : req.policy.ctx;
    const d = evaluate(tool, input, ctx, req.policy.cfg);
    if (d.decision !== 'allow' || !count) return d;
    return checkToolLimit(tool, counts, req.policy.cfg);
  };

  const refuse = (tool: string, input: Record<string, unknown>, d: Exclude<PolicyDecision, { decision: 'allow' }>, agent?: string): string => {
    denials++;
    if (d.decision === 'escalate') req.onEscalate({ tool, reason: d.reason, kind: d.kind, input });
    log({ type: 'policy', tool, decision: d.decision, reason: d.reason, agent, input: summarizeInput(input) });
    return d.decision === 'escalate'
      ? `Queued for a human: ${d.reason}. Do not retry or work around it; continue with other work and mention it in .sedef/notes.md.`
      : `Blocked by factory policy: ${d.reason}`;
  };

  // Runs for every tool call (main thread and subagents), before any permission logic.
  const preToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
    const d = decide(input.tool_name, toolInput, input.agent_type, true);
    if (d.decision === 'allow') {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: refuse(input.tool_name, toolInput, d, input.agent_type),
      },
    };
  };

  // Fallback if a permission prompt still happens: the policy answers, never a human.
  const canUseTool: CanUseTool = async (toolName, input) => {
    const d = decide(toolName, input, undefined, false);
    if (d.decision === 'allow') return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: refuse(toolName, input, d) };
  };

  // Ralph-style gate: the session may not end while the stage's quick check fails.
  const stopHook: HookCallback = async (input) => {
    if (input.hook_event_name !== 'Stop' || !req.stopGate) return {};
    if (nudges >= req.stopGate.maxNudges) return {};
    const r = await runCommand(req.stopGate.command, { cwd: req.cwd, timeoutMs: req.stopGate.timeoutSeconds * 1000, env: req.env });
    if (r.code === 0) return {};
    nudges++;
    log({ type: 'stop_gate', nudge: nudges, code: r.code, timedOut: r.timedOut });
    return {
      decision: 'block',
      reason: `Verification (\`${req.stopGate.command}\`) failed — nudge ${nudges}/${req.stopGate.maxNudges}. Fix the root cause before finishing. If it cannot be fixed in this session, write why in STATUS.md and .sedef/notes.md, then stop.\n\nOutput tail:\n${tail(r.output, 3000)}`,
    };
  };

  const options: Options = {
    cwd: req.cwd,
    model: req.model,
    ...(req.fallbackModel && req.fallbackModel !== req.model ? { fallbackModel: req.fallbackModel } : {}),
    ...(req.effort ? { effort: req.effort } : {}),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: req.mission },
    plugins: [{ type: 'local', path: req.pluginDir }],
    settingSources: ['user', 'project'],
    skills: 'all',
    mcpServers: req.mcpServers,
    // Only the stage's servers: user-scope or plugin MCP configs never leak into factory sessions.
    strictMcpConfig: true,
    tools: req.tools,
    disallowedTools: req.disallowedTools,
    additionalDirectories: req.additionalDirectories,
    permissionMode: 'default',
    canUseTool,
    hooks: {
      PreToolUse: [{ hooks: [preToolUse] }],
      ...(req.stopGate ? { Stop: [{ hooks: [stopHook], timeout: req.stopGate.timeoutSeconds + 60 }] } : {}),
    },
    maxTurns: req.maxTurns,
    maxBudgetUsd: req.budgetUsd,
    env: req.env,
    abortController: abort,
    title: req.title,
    ...(req.sandbox ? { sandbox: req.sandbox as NonNullable<Options['sandbox']> } : {}),
    ...(req.apiKeyHelper ? { settings: { apiKeyHelper: req.apiKeyHelper } } : {}),
    stderr: (data: string) => log({ type: 'stderr', data: truncate(data, 500) }),
  };

  const outcome: SessionOutcome = { ok: false, subtype: 'no_result', costUsd: 0, turns: 0, denials: 0, timedOut: false };
  log({ type: 'start', title: req.title, model: req.model, cwd: req.cwd, budget_usd: req.budgetUsd, max_turns: req.maxTurns, mcp: Object.keys(req.mcpServers) });

  const stopForAccount = (error: string) => {
    if (outcome.accountError) return;
    outcome.accountError = error;
    log({ type: 'account_error', error });
    abort.abort();
  };

  const handle = (msg: SDKMessage) => {
    if (msg.type === 'system' && msg.subtype === 'init') {
      const broken = msg.mcp_servers.filter((s) => s.status !== 'connected' && s.status !== 'pending');
      log({ type: 'init', session_id: msg.session_id, model: msg.model, tools: msg.tools, skills: msg.skills.length, plugins: msg.plugins.map((p) => p.name), plugin_errors: msg.plugin_errors ?? [], mcp_problems: broken });
      outcome.sessionId = msg.session_id;
    } else if (msg.type === 'system' && msg.subtype === 'api_retry') {
      log({ type: 'api_retry', attempt: msg.attempt, max: msg.max_retries, status: msg.error_status, error: msg.error, delay_ms: msg.retry_delay_ms });
      if (ACCOUNT_ERRORS.has(msg.error)) stopForAccount(msg.error);
    } else if (msg.type === 'assistant') {
      if (msg.error) {
        outcome.apiError = msg.error;
        log({ type: 'api_error', error: msg.error });
        if (ACCOUNT_ERRORS.has(msg.error)) stopForAccount(msg.error);
      }
      const blocks = (msg.message.content ?? []) as Block[];
      for (const b of blocks) {
        if (b.type === 'text' && b.text?.trim()) log({ type: 'text', agent: msg.parent_tool_use_id ? 'subagent' : 'main', text: truncate(b.text, 1500) });
        else if (b.type === 'tool_use') log({ type: 'tool', agent: msg.parent_tool_use_id ? 'subagent' : 'main', name: b.name, input: summarizeInput(b.input) });
      }
    } else if (msg.type === 'result') {
      // An API failure after the SDK's retries arrives as subtype "success" with is_error set.
      outcome.subtype = msg.subtype === 'success' && msg.is_error ? 'error_api' : msg.subtype;
      outcome.costUsd = msg.total_cost_usd ?? 0;
      outcome.turns = msg.num_turns ?? 0;
      outcome.sessionId = msg.session_id;
      outcome.ok = msg.subtype === 'success' && !msg.is_error;
      outcome.resultText = msg.subtype === 'success' ? truncate(msg.result, 4000) : msg.errors.join('\n');
      log({ type: 'result', subtype: outcome.subtype, cost_usd: outcome.costUsd, turns: outcome.turns, denials });
    }
  };

  try {
    for await (const msg of query({ prompt: req.prompt, options })) handle(msg);
  } catch (err) {
    outcome.error = outcome.accountError
      ? `API refused the account: ${outcome.accountError}`
      : abort.signal.aborted ? (timedOut ? 'session timed out' : 'session aborted') : (err as Error).message;
    log({ type: 'error', error: outcome.error });
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', onExternalAbort);
  }
  outcome.denials = denials;
  outcome.timedOut = timedOut;
  if (outcome.accountError) outcome.ok = false;
  return outcome;
}
