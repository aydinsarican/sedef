/**
 * Skill-improvement proposals written by the retro job. Learnings are applied
 * automatically (they are data); edits to skills need one human tap, because a
 * self-editing skill library is the classic poisoning path.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './paths.js';
import { runCommand, writeFileAtomic } from './util.js';

export function listProposals(paths: Paths): string[] {
  if (!fs.existsSync(paths.proposals)) return [];
  return fs.readdirSync(paths.proposals).filter((f) => f.endsWith('.md') && !f.startsWith('applied-') && !f.startsWith('rejected-')).sort();
}

export function extractDiff(markdown: string): string | undefined {
  const m = /```(?:diff|patch)\n([\s\S]*?)```/.exec(markdown);
  return m?.[1];
}

/** Apply the ```diff block of a proposal to the sedef repo with `git apply`. */
export async function applyProposal(paths: Paths, name: string): Promise<{ ok: boolean; message: string }> {
  const file = path.join(paths.proposals, path.basename(name));
  if (!fs.existsSync(file)) return { ok: false, message: `no such proposal: ${name}` };
  const diff = extractDiff(fs.readFileSync(file, 'utf8'));
  if (!diff) return { ok: false, message: 'proposal has no ```diff block' };
  if (/^\+\+\+ b\/(config\/policy\.yaml|runner\/)/m.test(diff)) return { ok: false, message: 'proposals may not change policy or runner code' };
  const patch = path.join(paths.proposals, `.${path.basename(name)}.patch`);
  writeFileAtomic(patch, diff.endsWith('\n') ? diff : diff + '\n');
  const check = await runCommand(`git apply --check '${patch}'`, { cwd: paths.root, timeoutMs: 60_000 });
  if (check.code !== 0) { fs.rmSync(patch, { force: true }); return { ok: false, message: `patch does not apply: ${check.output.slice(-400)}` }; }
  const r = await runCommand(`git apply '${patch}'`, { cwd: paths.root, timeoutMs: 60_000 });
  fs.rmSync(patch, { force: true });
  if (r.code !== 0) return { ok: false, message: r.output.slice(-400) };
  fs.renameSync(file, path.join(paths.proposals, `applied-${path.basename(name)}`));
  return { ok: true, message: `applied ${name}` };
}
