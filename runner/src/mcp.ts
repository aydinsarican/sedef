import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { McpCatalog, McpCatalogEntry } from './config.js';
import { createDataServer, DATA_SERVER_NAME } from './datatool.js';
import { expandVars, missingVars } from './env.js';

export interface BuiltMcp {
  servers: Record<string, McpServerConfig>;
  skipped: { name: string; reason: string }[];
}

function collectStrings(e: McpCatalogEntry): string[] {
  return [e.command ?? '', ...(e.args ?? []), ...Object.values(e.env ?? {}), e.url ?? '', ...Object.values(e.headers ?? {})];
}

const expandRecord = (r: Record<string, string> | undefined, env: NodeJS.ProcessEnv): Record<string, string> | undefined =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, expandVars(v, env)])) : undefined;

/**
 * Resolve the MCP servers a stage asked for. Secrets are expanded here, in the
 * foreman, so they reach the MCP server config but never the agent's shell env.
 * A server whose required ${VAR} is missing is skipped rather than sent a
 * literal placeholder.
 */
export function buildMcpServers(catalog: McpCatalog, names: string[], env: NodeJS.ProcessEnv): BuiltMcp {
  const out: BuiltMcp = { servers: {}, skipped: [] };
  for (const name of names) {
    if (name === DATA_SERVER_NAME) { out.servers[name] = createDataServer(); continue; }
    const entry = catalog[name];
    if (!entry) { out.skipped.push({ name, reason: 'not in config/mcp.json' }); continue; }
    const missing = collectStrings(entry).flatMap((s) => missingVars(s, env));
    if (missing.length) { out.skipped.push({ name, reason: `missing env: ${[...new Set(missing)].join(', ')}` }); continue; }
    const isRemote = entry.type === 'http' || entry.type === 'sse';
    if (isRemote) {
      if (!entry.url) { out.skipped.push({ name, reason: 'remote server without url' }); continue; }
      const headers = expandRecord(entry.headers, env);
      out.servers[name] = {
        type: entry.type as 'http',
        url: expandVars(entry.url, env),
        ...(headers ? { headers } : {}),
        ...(entry.timeout ? { timeout: entry.timeout } : {}),
      } as McpServerConfig;
    } else {
      if (!entry.command) { out.skipped.push({ name, reason: 'stdio server without command' }); continue; }
      const envVars = expandRecord(entry.env, env);
      out.servers[name] = {
        type: 'stdio',
        command: expandVars(entry.command, env),
        args: (entry.args ?? []).map((a) => expandVars(a, env)),
        ...(envVars ? { env: { PATH: env.PATH ?? '', HOME: env.HOME ?? '', ...envVars } } : {}),
        ...(entry.timeout ? { timeout: entry.timeout } : {}),
      };
    }
  }
  return out;
}
