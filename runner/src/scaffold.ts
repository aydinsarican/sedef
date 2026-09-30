import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SedefConfig } from './config.js';
import { expandHome, type Paths } from './paths.js';
import type { Idea } from './state.js';
import { ensureDir, localParts, readJson, runCommand, walkFiles, writeJsonAtomic } from './util.js';

const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.json', '.sh', '.swift', '.plist', '.xcprivacy', '.txt', '.ts', '.tsx', '.js', '.mjs', '.html', '.css', '.gitignore', '.env', '.toml', '']);

/** Lane → template folder under templates/. Lanes without their own folder use the command-driven generic verifier. */
export const LANE_TEMPLATES: Record<string, string> = {
  ios: 'ios',
  expo_dual: 'expo',
  web_saas: 'web',
  chrome_extension: 'chrome-extension',
  mac_direct: 'generic',
  apify_actor: 'generic',
  figma_plugin: 'generic',
  digital_assets: 'generic',
};

export function pascalName(slug: string): string {
  const name = slug.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(name) ? `App${name}` : name || 'App';
}

export function templateVars(slug: string, title: string, lane: string, cfg: SedefConfig, env: NodeJS.ProcessEnv): Record<string, string> {
  const appName = pascalName(slug);
  return {
    PRODUCT_SLUG: slug,
    PRODUCT_TITLE: title,
    LANE: lane,
    DATE: localParts(new Date(), cfg.factory.timezone).date,
    APP_NAME: appName,
    BUNDLE_ID: `${cfg.factory.bundle_id_prefix}.${slug.replace(/-/g, '')}`,
    SUPPORT_EMAIL: cfg.factory.support_email,
    TEAM_ID: env.APPLE_TEAM_ID ?? '',
    PRIMARY_LOCALE: cfg.factory.primary_locale,
  };
}

const renderPlaceholders = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));

/** Copy a template tree, rendering {{PLACEHOLDERS}}; never overwrites existing files. Returns created paths. */
export function copyTemplate(srcDir: string, destDir: string, vars: Record<string, string>): string[] {
  if (!fs.existsSync(srcDir)) return [];
  const created: string[] = [];
  for (const src of walkFiles(srcDir)) {
    const rel = path.relative(srcDir, src);
    const destRel = rel.endsWith('.tmpl') ? rel.slice(0, -5) : rel;
    const dest = path.join(destDir, renderPlaceholders(destRel, vars));
    if (fs.existsSync(dest)) continue;
    ensureDir(path.dirname(dest));
    const ext = path.extname(dest) || (path.basename(dest).startsWith('.') ? path.basename(dest) : '');
    if (TEXT_EXT.has(ext) || TEXT_EXT.has(path.extname(dest))) {
      fs.writeFileSync(dest, renderPlaceholders(fs.readFileSync(src, 'utf8'), vars));
    } else {
      fs.copyFileSync(src, dest);
    }
    fs.chmodSync(dest, fs.statSync(src).mode & 0o777);
    created.push(path.relative(destDir, dest));
  }
  return created;
}

async function git(cmd: string, cwd: string): Promise<void> {
  const r = await runCommand(cmd, { cwd, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`git failed (${cmd}): ${r.output.slice(-500)}`);
}

export async function commitAll(cwd: string, message: string): Promise<boolean> {
  const status = await runCommand('git status --porcelain', { cwd, timeoutMs: 60_000 });
  if (status.code !== 0 || !status.output.trim()) return false;
  const msg = message.replace(/'/g, "'\\''");
  await git(`git add -A && git -c user.name='Sedef Factory' -c user.email='factory@sedef.local' commit -q -m '${msg}'`, cwd);
  return true;
}

export async function pushIfRemote(cwd: string): Promise<void> {
  const r = await runCommand('git remote', { cwd, timeoutMs: 30_000 });
  if (r.code === 0 && r.output.includes('origin')) await runCommand('git push -q origin HEAD', { cwd, timeoutMs: 180_000 });
}

/** Create a product repo from an approved idea: base template, idea card, git init, optional private GitHub repo. */
export async function scaffoldProduct(
  paths: Paths,
  cfg: SedefConfig,
  idea: Idea,
  slug: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const productsDir = path.resolve(expandHome(cfg.factory.products_dir, os.homedir()));
  const dir = path.join(productsDir, slug);
  ensureDir(dir);
  const vars = templateVars(slug, idea.title, idea.lane, cfg, env);
  copyTemplate(path.join(paths.templates, 'product'), dir, vars);

  const card = readJson<Record<string, unknown>>(idea.card_path, { title: idea.title, summary_tr: idea.summary_tr, lane: idea.lane });
  writeJsonAtomic(path.join(dir, '.sedef', 'idea.json'), { ...card, id: idea.id, source: idea.source });
  const mdCard = idea.card_path.replace(/\.json$/, '.md');
  if (fs.existsSync(mdCard)) fs.copyFileSync(mdCard, path.join(dir, '.sedef', 'idea.md'));

  if (!fs.existsSync(path.join(dir, '.git'))) await git('git init -q -b main', dir);
  await commitAll(dir, `chore: scaffold ${slug} from sedef (${idea.id})`);

  const owner = cfg.factory.github_owner;
  if (owner) {
    const r = await runCommand(`gh repo create '${owner}/${slug}' --private --source . --remote origin --push`, { cwd: dir, timeoutMs: 180_000, env });
    if (r.code !== 0) console.error(`[scaffold] gh repo create failed for ${slug}: ${r.output.slice(-300)}`);
  }
  return dir;
}

/** Overlay the lane template once the lane is decided (after validation). Idempotent. */
export async function applyLaneTemplate(paths: Paths, cfg: SedefConfig, dir: string, slug: string, title: string, lane: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const vars = templateVars(slug, title, lane, cfg, env);
  const created: string[] = [];
  const repo = cfg.lanes[lane]?.template_repo;
  if (repo) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sedef-lane-'));
    const r = await runCommand(`git clone -q --depth 1 '${repo.replace(/'/g, '')}' '${tmp}/repo'`, { cwd: tmp, timeoutMs: 300_000, env });
    if (r.code === 0) {
      const src = path.join(tmp, 'repo');
      const laneClaude = path.join(src, 'CLAUDE.md');
      if (fs.existsSync(laneClaude)) {
        fs.appendFileSync(path.join(dir, 'CLAUDE.md'), `\n\n## Lane template rules (from ${repo})\n\n${fs.readFileSync(laneClaude, 'utf8')}`);
        fs.rmSync(laneClaude);
      }
      fs.rmSync(path.join(src, '.git'), { recursive: true, force: true });
      created.push(...copyTemplate(src, dir, vars));
    } else {
      console.error(`[scaffold] cloning lane template ${repo} failed: ${r.output.slice(-300)}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const folder = LANE_TEMPLATES[lane];
  if (folder) created.push(...copyTemplate(path.join(paths.templates, folder), dir, vars));
  if (created.length) await commitAll(dir, `chore: apply ${lane} lane template`);
  return created;
}
