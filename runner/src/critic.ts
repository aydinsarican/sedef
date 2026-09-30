/**
 * Cross-vendor critic. LLM judges from one family share blind spots
 * ("Artificial Hivemind", NeurIPS 2025), so design critique is routed to a
 * different vendor when configured. Keys are read by this process, not
 * passed through the agent's environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SedefConfig } from './config.js';

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export async function runCritic(cfg: SedefConfig, prompt: string, images: string[]): Promise<string> {
  if (!cfg.critic.enabled) throw new Error('critic is disabled (config: critic.enabled)');
  const imgs = images.map((f) => {
    const mime = MIME[path.extname(f).toLowerCase()];
    if (!mime) throw new Error(`unsupported image type: ${f}`);
    return { mime, b64: fs.readFileSync(f).toString('base64') };
  });

  if (cfg.critic.provider === 'gemini') {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set in ~/.sedef/.env');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.critic.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, ...imgs.map((i) => ({ inline_data: { mime_type: i.mime, data: i.b64 } }))] }] }),
      signal: AbortSignal.timeout(240_000),
    });
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: unknown };
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 500)}`);
    return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in ~/.sedef/.env');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.critic.model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...imgs.map((i) => ({ type: 'input_image', image_url: `data:${i.mime};base64,${i.b64}` }))] }],
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = (await res.json()) as { output_text?: string; output?: { content?: { type: string; text?: string }[] }[]; error?: unknown };
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 500)}`);
  if (json.output_text) return json.output_text.trim();
  return (json.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('').trim();
}
