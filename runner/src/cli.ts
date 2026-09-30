#!/usr/bin/env node
/**
 * sedef — CLI for the factory foreman.
 *
 *   sedef start                 run the foreman daemon (launchd calls this)
 *   sedef tick                  run one scheduling pass and wait for its jobs
 *   sedef status                products, spend, pending chores
 *   sedef idea "<text>"         put your own idea straight into the pipeline
 *   sedef approve|reject <id>   decide on an idea card
 *   sedef chores                list chores waiting for you
 *   sedef done <id> [option]    close a chore
 *   sedef run <slug> <stage>    force a product into a stage
 *   sedef kill <slug>           stop a product
 *   sedef pause | resume        kill switch
 *   sedef budget                spend summary
 *   sedef novelty check <fingerprint.json> [--slug s]
 *   sedef critic --prompt-file f --images a.png,b.png
 *   sedef proposals [apply <n>] skill-improvement proposals from retro
 *   sedef doctor                check the host setup
 *   sedef hook pretooluse       PreToolUse hook for interactive Claude Code
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSpend } from './budget.js';
import { loadConfig, loadMcpCatalog, loadPipeline, loadPolicy } from './config.js';
import { runCritic } from './critic.js';
import { statusSummary } from './digest.js';
import { runDoctor } from './doctor.js';
import { loadEnvFile } from './env.js';
import { Foreman } from './foreman.js';
import { runHook } from './hook.js';
import { checkNovelty, type Fingerprint } from './novelty.js';
import { resolvePaths } from './paths.js';
import { applyProposal, listProposals } from './proposals.js';
import { ensureDir, readJson, readJsonl, writeJsonAtomic } from './util.js';

const stripHtml = (s: string): string => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function daemonRunning(lock: string): boolean {
  if (!fs.existsSync(lock)) return false;
  const pid = Number(fs.readFileSync(lock, 'utf8').trim());
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const USAGE = `sedef — autonomous product factory foreman

  sedef start                 run the foreman daemon (launchd calls this)
  sedef tick                  run one scheduling pass and wait for its jobs
  sedef status                products, spend, pending chores
  sedef idea "<text>"         put your own idea straight into the pipeline
  sedef approve|reject <id>   decide on an idea card
  sedef chores                list chores waiting for you
  sedef done <id> [option]    close a chore
  sedef run <slug> <stage>    force a product into a stage
  sedef kill <slug>           stop a product
  sedef pause | resume        kill switch
  sedef budget                spend summary
  sedef novelty check <fingerprint.json> [--slug s]
  sedef critic --prompt-file f --images a.png,b.png
  sedef proposals [apply <n>] skill-improvement proposals from retro
  sedef doctor                check the host setup
  sedef validate-config       parse every config file and exit
  sedef hook pretooluse       PreToolUse hook for interactive Claude Code`;

async function main(): Promise<number> {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  const paths = resolvePaths();
  loadEnvFile(paths.envFile);
  if (!process.env.SEDEF_HOME) process.env.SEDEF_HOME = paths.root;

  if (cmd === 'hook') return runHook(args[0] ?? '', loadPolicy(paths));
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(USAGE); return 0; }

  const cfg = loadConfig(paths);
  const pipeline = loadPipeline(paths);
  const policy = loadPolicy(paths);
  const catalog = loadMcpCatalog(paths);
  const foreman = () => new Foreman(paths, cfg, pipeline, policy, catalog);

  // Mutating commands: queue for the daemon if it holds the state, else run directly.
  const MUTATING: Record<string, string> = { idea: '/fikir', approve: '/onayla', reject: '/gec', done: '/tamam', run: '/calistir', kill: '/oldur', pause: '/dur', resume: '/devam', rejection: '/red' };
  if (cmd in MUTATING) {
    if (daemonRunning(paths.lock)) {
      const inbox = path.join(paths.factory, 'inbox');
      ensureDir(inbox);
      writeJsonAtomic(path.join(inbox, `${Date.now()}-${process.pid}.json`), { cmd: MUTATING[cmd], args });
      console.log('Queued for the running foreman (applied on its next heartbeat).');
      return 0;
    }
    const out = await foreman().handleCommand(MUTATING[cmd]!, args.join(' '), args);
    console.log(stripHtml(out));
    return 0;
  }

  switch (cmd) {
    case 'start':
      await foreman().start();
      return 0;
    case 'tick':
      await foreman().start({ once: true });
      return 0;
    case 'status': {
      const f = foreman();
      console.log(stripHtml(statusSummary(f.state, loadSpend(paths.spend, new Date(), cfg.factory.timezone), cfg)));
      return 0;
    }
    case 'chores': {
      const out = await foreman().handleCommand('/isler', '', []);
      console.log(stripHtml(out));
      return 0;
    }
    case 'budget': {
      const out = await foreman().handleCommand('/butce', '', []);
      console.log(stripHtml(out));
      return 0;
    }
    case 'novelty': {
      if (args[0] !== 'check' || !args[1]) { console.error('usage: sedef novelty check <fingerprint.json> [--slug <slug>]'); return 2; }
      const fp = readJson<Fingerprint | undefined>(args[1], undefined);
      if (!fp) { console.error(`cannot read ${args[1]}`); return 2; }
      const slug = flag(args, '--slug') ?? fp.product ?? process.env.SEDEF_PRODUCT ?? 'candidate';
      const res = checkNovelty({ ...fp, product: slug }, readJsonl<Fingerprint>(paths.ledger), cfg.novelty);
      console.log(JSON.stringify(res, null, 2));
      return res.pass ? 0 : 1;
    }
    case 'critic': {
      if (!cfg.critic.enabled) { console.error('critic disabled — use the evaluator subagent with plugin/skills/taste-engine/references/critique-rubric.md'); return 3; }
      const promptFile = flag(args, '--prompt-file');
      const prompt = promptFile ? fs.readFileSync(promptFile, 'utf8') : flag(args, '--prompt');
      if (!prompt) { console.error('usage: sedef critic --prompt-file <f> [--images a.png,b.png]'); return 2; }
      const images = (flag(args, '--images') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      console.log(await runCritic(cfg, prompt, images));
      return 0;
    }
    case 'proposals': {
      if (args[0] === 'apply' && args[1]) {
        const list = listProposals(paths);
        const res = await applyProposal(paths, list[Number(args[1]) - 1] ?? args[1]);
        console.log(res.message);
        return res.ok ? 0 : 1;
      }
      const list = listProposals(paths);
      console.log(list.length ? list.map((f, i) => `${i + 1}. ${f}`).join('\n') : 'No pending proposals.');
      return 0;
    }
    case 'doctor':
      return runDoctor(paths, cfg, pipeline, catalog);
    case 'validate-config':
      console.log(`config ok · ${pipeline.order.length} stages · ${Object.keys(catalog).length} MCP servers in catalog`);
      return 0;
    default:
      console.log(USAGE);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error((err as Error).message); process.exitCode = 1; });
