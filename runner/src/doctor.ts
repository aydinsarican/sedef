import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpCatalog, PipelineConfig, SedefConfig } from './config.js';
import { missingVars } from './env.js';
import { expandHome, type Paths } from './paths.js';
import { Telegram } from './telegram.js';
import { runCommand } from './util.js';

interface Row { name: string; ok: boolean; required: boolean; detail: string; hint: string }

async function cmd(command: string, timeoutMs = 30_000): Promise<{ ok: boolean; out: string }> {
  const r = await runCommand(command, { cwd: os.homedir(), timeoutMs });
  return { ok: r.code === 0, out: r.output.trim().split('\n')[0] ?? '' };
}

export async function runDoctor(paths: Paths, cfg: SedefConfig, pipeline: PipelineConfig, catalog: McpCatalog): Promise<number> {
  const rows: Row[] = [];
  const add = (name: string, ok: boolean, required: boolean, detail: string, hint: string) => rows.push({ name, ok, required, detail, hint });
  const mac = process.platform === 'darwin';
  const ios = cfg.lanes.ios?.enabled || cfg.lanes.expo_dual?.enabled;

  add('Node.js ≥ 22', Number(process.versions.node.split('.')[0]) >= 22, true, process.versions.node, 'brew install node');
  add('macOS host', mac, !!ios, process.platform, 'iOS builds need macOS + Xcode (a Mac mini is the usual factory host)');

  let r = await cmd('claude --version');
  add('Claude Code CLI', r.ok, false, r.out, 'admin: ./install.sh --deps · standard user: npm i -g --prefix ~/.local @anthropic-ai/claude-code (the SDK ships its own binary; the CLI is for plugin validate, MCP logins and humans)');

  if (cfg.auth.mode === 'keychain') {
    r = await cmd(`security find-generic-password -a '${cfg.auth.keychain_account}' -s '${cfg.auth.keychain_service}' >/dev/null 2>&1`);
    add('Anthropic API key in keychain', r.ok, true, r.ok ? 'found' : 'missing', './install.sh --set-api-key');
  } else if (cfg.auth.mode === 'env') {
    add('ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY, true, process.env.ANTHROPIC_API_KEY ? 'set' : 'missing', 'add it to ~/.sedef/.env');
  } else {
    add('CLAUDE_CODE_OAUTH_TOKEN', !!process.env.CLAUDE_CODE_OAUTH_TOKEN, true, process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'set' : 'missing', 'claude setup-token → ~/.sedef/.env');
  }

  if (mac && ios) {
    r = await cmd('xcodebuild -version'); add('Xcode', r.ok, true, r.out, 'install Xcode, then: sudo xcodebuild -license accept');
    r = await cmd('xcrun simctl list devices available | grep -c iPhone'); add('iPhone simulators', r.ok && Number(r.out) > 0, true, `${r.out} available`, 'Xcode → Settings → Components → iOS runtime');
    r = await cmd('xcodegen --version'); add('XcodeGen', r.ok, true, r.out, 'brew install xcodegen');
    r = await cmd('asc auth status --validate', 60_000); add('asc (App Store Connect) auth', r.ok, true, r.out, 'asc auth login --name factory --key-id … --issuer-id … --private-key ~/.asc/AuthKey_….p8 --network');
    r = await cmd('maestro --version'); add('Maestro', r.ok, true, r.out, 'brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro');
    r = await cmd('java -version 2>&1'); add('Java 17+ (Maestro)', r.ok, true, r.out, 'brew install openjdk@17 and set JAVA_HOME in ~/.sedef/.env');
    r = await cmd('xcrun mcp-server status 2>&1'); add('Xcode MCP server (Xcode 27, optional)', r.ok, false, r.out, 'sudo xcrun mcp-server enable --unsafe-always-allow-all-agents');
  }
  r = await cmd('gh auth status 2>&1'); add('GitHub CLI auth', r.ok, !!cfg.factory.github_owner, r.out, 'gh auth login');
  r = await cmd('uvx --version'); add('uv / uvx (Python MCP servers)', r.ok, false, r.out, 'brew install uv');
  r = await cmd(`claude plugin validate '${paths.plugin}' 2>&1`, 60_000); add('Sedef plugin validates', r.ok, false, r.out, 'claude plugin validate plugin/ and fix the reported file');

  add('Support e-mail configured', !!cfg.factory.support_email, true, cfg.factory.support_email || '(empty)', 'factory.support_email in config/sedef.config.yaml — store listings must use a real, monitored address');
  const productsDir = path.resolve(expandHome(cfg.factory.products_dir));
  let writable = false;
  try { fs.mkdirSync(productsDir, { recursive: true }); fs.accessSync(productsDir, fs.constants.W_OK); writable = true; } catch { writable = false; }
  add('Products directory writable', writable, true, productsDir, 'check factory.products_dir');

  if (cfg.notify.telegram) {
    const tg = Telegram.fromEnv();
    const me = tg ? await tg.getMe() : undefined;
    add('Telegram bot', !!me, true, me ? `@${me.username}` : 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing or invalid', 'create a bot with @BotFather; see docs/SETUP.md');
    // A group chat (negative id) without an allow-list would ignore everyone, /dur included.
    const isGroup = (process.env.TELEGRAM_CHAT_ID ?? '').trim().startsWith('-');
    add('Telegram allowed users', !!process.env.TELEGRAM_ALLOWED_USER_IDS, isGroup, process.env.TELEGRAM_ALLOWED_USER_IDS ?? (isGroup ? 'missing — required for a group chat' : '(private chat: your id)'), 'TELEGRAM_ALLOWED_USER_IDS=<your numeric id(s), comma-separated>');
  }

  const wanted = new Set(Object.values(pipeline.stages).flatMap((s) => s.mcp).filter((m) => m !== 'sedef_data'));
  for (const name of wanted) {
    const e = catalog[name];
    if (!e) { add(`MCP ${name}`, false, false, 'not in config/mcp.json', 'add it or remove it from pipeline.yaml'); continue; }
    const strings = [e.command ?? '', ...(e.args ?? []), ...Object.values(e.env ?? {}), e.url ?? '', ...Object.values(e.headers ?? {})];
    const missing = [...new Set(strings.flatMap((s) => missingVars(s)))];
    const oauth = e.auth === 'oauth';
    add(`MCP ${name}`, missing.length === 0, false, missing.length ? `missing ${missing.join(', ')} (stage will run without it)` : oauth ? `oauth — once: claude mcp add --scope user --transport http ${name} ${e.url ?? '<url>'} && claude mcp login ${name}` : 'ok', missing.length ? 'set the variable in ~/.sedef/.env' : '');
  }

  const w = Math.max(...rows.map((x) => x.name.length));
  let failedRequired = 0;
  for (const x of rows) {
    const icon = x.ok ? '✅' : x.required ? '❌' : '⚠️ ';
    if (!x.ok && x.required) failedRequired++;
    console.log(`${icon} ${x.name.padEnd(w)}  ${x.detail}${!x.ok && x.hint ? `\n   ↳ ${x.hint}` : ''}`);
  }
  console.log(failedRequired ? `\n${failedRequired} required check(s) failed.` : '\nAll required checks passed.');
  return failedRequired ? 1 : 0;
}
