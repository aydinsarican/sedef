import fs from 'node:fs';
import os from 'node:os';

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** Expand ~, $VAR, ${VAR} and ${VAR:-default} against env. */
export function expandVars(val: string, env: NodeJS.ProcessEnv = process.env): string {
  return val
    .replace(/^~(?=\/|$)/, os.homedir())
    .replace(VAR_RE, (_m, braced: string | undefined, def: string | undefined, bare: string | undefined) => {
      const key = (braced ?? bare)!;
      const v = env[key];
      return v !== undefined && v !== '' ? v : (def ?? '');
    });
}

/** ${VAR} references (without a default) that are unset or empty in env. */
export function missingVars(val: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  for (const m of val.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g)) {
    const key = m[1]!;
    const hasDefault = m[2] !== undefined;
    if (!hasDefault && (env[key] === undefined || env[key] === '')) missing.push(key);
  }
  return missing;
}

/**
 * Load KEY=VALUE lines from a dotenv-style file. Existing non-empty process
 * values win, so launchd/shell overrides keep working. Returns loaded keys.
 */
export function loadEnvFile(file: string, target: NodeJS.ProcessEnv = process.env): string[] {
  if (!fs.existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    const quoted = (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
    if (quoted) {
      val = val.slice(1, -1);
    } else {
      const hash = val.indexOf(' #');
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    val = expandVars(val, target);
    if (target[key] === undefined || target[key] === '') {
      target[key] = val;
      loaded.push(key);
    }
  }
  return loaded;
}
