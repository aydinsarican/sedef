/**
 * PreToolUse hook entry for humans using Claude Code interactively in a
 * product repo (the plugin's hooks.json calls `sedef hook pretooluse`).
 * Factory sessions skip it: the SDK enforces the same policy in-process.
 */
import type { PolicyConfig } from './config.js';
import { evaluate, interactiveContext } from './policy.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runHook(kind: string, policy: PolicyConfig): Promise<number> {
  if (process.env.SEDEF_SDK_SESSION === '1' || kind !== 'pretooluse') return 0;
  let input: { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };
  try { input = JSON.parse(await readStdin()); } catch { return 0; }
  if (!input.tool_name) return 0;
  const d = evaluate(input.tool_name, input.tool_input ?? {}, interactiveContext(input.cwd ?? process.cwd()), policy);
  if (d.decision === 'allow') return 0;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: d.decision === 'deny' ? 'deny' : 'ask',
      permissionDecisionReason: `sedef policy: ${d.reason}`,
    },
  }));
  return 0;
}
