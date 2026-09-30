import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

export const nowIso = (d: Date = new Date()): string => d.toISOString();

export interface LocalParts {
  date: string; // YYYY-MM-DD in the factory time zone
  time: string; // HH:MM (24h)
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Calendar parts of `d` as seen in `timeZone` (IANA name, e.g. Europe/Istanbul). */
export function localParts(d: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export const addMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);

export const tail = (s: string, max = 2000): string => (s.length <= max ? s : '…' + s.slice(s.length - max));
export const truncate = (s: string, max = 2000): string => (s.length <= max ? s : s.slice(0, max) + '…');
export const sha256 = (buf: string | Buffer): string => createHash('sha256').update(buf).digest('hex');

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file: string, fallback = ''): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

export function writeFileAtomic(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export const writeJsonAtomic = (file: string, data: unknown): void =>
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');

export function appendJsonl(file: string, row: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* skip corrupt line */ }
  }
  return rows;
}

const globCache = new Map<string, RegExp>();

/** Minimal glob → RegExp: `**` spans directories, `*` and `?` stay within one segment. */
export function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  const compiled = new RegExp('^' + re + '$');
  globCache.set(glob, compiled);
  return compiled;
}

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'DerivedData', 'build', '.build', 'Pods', 'dist', '.next', '.expo', '.turbo', '.venv']);

/** Recursively list files under root (absolute paths), skipping heavy build folders. */
export function walkFiles(root: string, limit = 50_000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!DEFAULT_IGNORES.has(e.name)) stack.push(full); }
      else if (e.isFile()) out.push(full);
    }
  }
  return out;
}

export interface CmdResult { code: number | null; output: string; timedOut: boolean }

/** Process groups of commands still running, so a shutting-down foreman can take them down with it. */
const liveGroups = new Set<number>();

export function killAllCommands(sig: NodeJS.Signals = 'SIGTERM'): number {
  let n = 0;
  for (const pid of liveGroups) {
    try { process.kill(-pid, sig); n++; } catch { /* already gone */ }
  }
  return n;
}

/** Run a shell command with a hard timeout; stdout+stderr are merged and capped. */
export function runCommand(
  cmd: string,
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; maxOutput?: number },
): Promise<CmdResult> {
  return new Promise((resolve) => {
    // Own process group, so a timeout takes down xcodebuild/simulators/dev servers the script started, too.
    const child = spawn('/bin/bash', ['-c', cmd], { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    if (child.pid) liveGroups.add(child.pid);
    const max = opts.maxOutput ?? 200_000;
    let out = '';
    let settled = false;
    const finish = (r: CmdResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) liveGroups.delete(child.pid);
      resolve(r);
    };
    const onData = (b: Buffer) => {
      out += b.toString();
      if (out.length > max) out = out.slice(out.length - max);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const killGroup = (sig: NodeJS.Signals) => {
      try { if (child.pid) process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      setTimeout(() => {
        killGroup('SIGKILL');
        // A grandchild that escaped the group may still hold the pipes: don't wait for EOF.
        setTimeout(() => finish({ code: null, output: out, timedOut: true }), 2000).unref();
      }, 5000).unref();
    }, opts.timeoutMs);
    child.on('close', (code) => finish({ code, output: out, timedOut }));
    child.on('error', (err) => finish({ code: -1, output: String(err), timedOut }));
  });
}

export const htmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Read a dotted field ("a.b.c") from a JSON-like value. */
export function getField(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const key of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Set a dotted field on a plain object, creating intermediate objects. Returns false if a non-object is in the way. */
export function setField(obj: Record<string, unknown>, dotted: string, value: unknown): boolean {
  const keys = dotted.split('.');
  let cur: Record<string, unknown> = obj;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (next === undefined || next === null) cur[key] = {};
    else if (typeof next !== 'object' || Array.isArray(next)) return false;
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys.at(-1)!] = value;
  return true;
}
