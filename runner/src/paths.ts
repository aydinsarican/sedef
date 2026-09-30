import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function expandHome(p: string, home = os.homedir()): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

/** Repo root: $SEDEF_HOME, else three levels up from runner/dist/src. */
export function repoRoot(): string {
  if (process.env.SEDEF_HOME) return path.resolve(expandHome(process.env.SEDEF_HOME));
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..');
}

export interface Paths {
  root: string;
  config: string;
  pipeline: string;
  policy: string;
  mcp: string;
  prompts: string;
  plugin: string;
  templates: string;
  factory: string;
  state: string;
  lock: string;
  logs: string;
  sessions: string;
  spend: string;
  ideas: string;
  cards: string;
  ledger: string;
  learnings: string;
  reports: string;
  portfolio: string;
  proposals: string;
  userDir: string;
  envFile: string;
  secrets: string;
}

export function resolvePaths(root: string = repoRoot()): Paths {
  const factory = path.join(root, 'factory');
  const userDir = path.join(os.homedir(), '.sedef');
  return {
    root,
    config: path.join(root, 'config', 'sedef.config.yaml'),
    pipeline: path.join(root, 'config', 'pipeline.yaml'),
    policy: path.join(root, 'config', 'policy.yaml'),
    mcp: path.join(root, 'config', 'mcp.json'),
    prompts: path.join(root, 'prompts', 'stages'),
    plugin: path.join(root, 'plugin'),
    templates: path.join(root, 'templates'),
    factory,
    state: path.join(factory, 'state.json'),
    lock: path.join(factory, 'foreman.lock'),
    logs: path.join(factory, 'logs'),
    sessions: path.join(factory, 'logs', 'sessions'),
    spend: path.join(factory, 'spend.jsonl'),
    ideas: path.join(factory, 'ideas'),
    cards: path.join(factory, 'ideas', 'cards'),
    ledger: path.join(factory, 'ledger', 'novelty.jsonl'),
    learnings: path.join(factory, 'learnings'),
    reports: path.join(factory, 'reports'),
    portfolio: path.join(factory, 'portfolio'),
    proposals: path.join(factory, 'proposals'),
    userDir,
    envFile: path.join(userDir, '.env'),
    secrets: path.join(userDir, 'secrets'),
  };
}
