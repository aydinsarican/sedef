import fs from 'node:fs';
import path from 'node:path';
import type { VerifyCheck } from './config.js';
import { getField, readJson, runCommand, tail } from './util.js';

export interface VerifyResult {
  pass: boolean;
  failures: string[];
}

export interface VerifyDeps {
  env: NodeJS.ProcessEnv;
  novelty: () => { pass: boolean; violations: string[] };
}

/** Deterministic exit checks that decide whether a stage is really done. */
export async function runChecks(checks: VerifyCheck[], cwd: string, deps: VerifyDeps): Promise<VerifyResult> {
  const failures: string[] = [];
  for (const c of checks) {
    switch (c.kind) {
      case 'files_exist': {
        const missing = c.paths.filter((p) => !fs.existsSync(path.join(cwd, p)));
        if (missing.length) failures.push(`missing required output(s): ${missing.join(', ')}`);
        break;
      }
      case 'json_field': {
        const file = path.join(cwd, c.file);
        const data = readJson<unknown>(file, undefined);
        if (data === undefined) { failures.push(`${c.file} is missing or not valid JSON`); break; }
        const v = getField(data, c.field);
        if (!c.one_of.includes(String(v))) failures.push(`${c.file} → ${c.field} must be one of [${c.one_of.join(', ')}], got ${JSON.stringify(v)}`);
        break;
      }
      case 'command': {
        const r = await runCommand(c.run, { cwd, timeoutMs: (c.timeout_seconds ?? 900) * 1000, env: deps.env });
        if (r.timedOut) failures.push(`\`${c.run}\` timed out after ${c.timeout_seconds ?? 900}s\n${tail(r.output, 1500)}`);
        else if (r.code !== 0) failures.push(`\`${c.run}\` exited ${r.code}\n${tail(r.output, 2500)}`);
        break;
      }
      case 'novelty': {
        const n = deps.novelty();
        if (!n.pass) failures.push(`novelty check failed:\n- ${n.violations.join('\n- ')}`);
        break;
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

/** Snapshot files matching immutable globs so tampering (via Bash, say) can be undone. */
export interface Snapshot { files: Map<string, Buffer>; }

export function snapshotFiles(cwd: string, relGlobs: string[], walk: (root: string) => string[], matches: (abs: string) => boolean): Snapshot {
  const files = new Map<string, Buffer>();
  if (!relGlobs.length) return { files };
  for (const f of walk(cwd)) if (matches(f)) files.set(f, fs.readFileSync(f));
  return { files };
}

/** Restore changed/deleted snapshot files and delete new files that match the immutable globs. */
export function restoreSnapshot(snap: Snapshot, cwd: string, walk: (root: string) => string[], matches: (abs: string) => boolean): string[] {
  const touched: string[] = [];
  for (const [file, buf] of snap.files) {
    let current: Buffer | undefined;
    try { current = fs.readFileSync(file); } catch { current = undefined; }
    if (!current || !current.equals(buf)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      touched.push(path.relative(cwd, file));
    }
  }
  if (snap.files.size) {
    for (const f of walk(cwd)) {
      if (matches(f) && !snap.files.has(f)) {
        fs.rmSync(f, { force: true });
        touched.push(path.relative(cwd, f) + ' (new, removed)');
      }
    }
  }
  return touched;
}
