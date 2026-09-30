import { pendingChores, formatChore } from './chores.js';
import type { SedefConfig } from './config.js';
import type { SpendTotals } from './budget.js';
import type { FactoryState, Product } from './state.js';
import { htmlEscape, localParts } from './util.js';

export const STAGE_TR: Record<string, string> = {
  scout: 'Keşif',
  validate: 'Doğrulama',
  spec: 'Spesifikasyon',
  brand: 'Marka',
  design: 'Tasarım',
  build: 'İnşa',
  qa: 'Kalite',
  store: 'Mağaza hazırlığı',
  release: 'Yayın',
  release_watch: 'İnceleme takibi',
  review_fix: 'Red düzeltme',
  launch: 'Lansman',
  grow: 'Büyüme',
  portfolio: 'Portföy',
  retro: 'Retro',
  killed: 'Durduruldu',
  sunset: 'Emekli',
};

const STATUS_ICON: Record<Product['status'], string> = {
  ready: '⏳',
  running: '⚙️',
  waiting: '💤',
  blocked: '⛔',
  failed: '🧯',
  done: '✅',
};

export const stageTr = (s: string): string => STAGE_TR[s] ?? s;

export function productLine(p: Product): string {
  return `${STATUS_ICON[p.status]} <b>${htmlEscape(p.slug)}</b> · ${stageTr(p.stage)} · $${p.spend_usd.toFixed(0)}`;
}

export function statusSummary(state: FactoryState, spend: SpendTotals, cfg: SedefConfig): string {
  const products = Object.values(state.products).sort((a, b) => a.slug.localeCompare(b.slug));
  const lines = [
    `🦪 <b>Sedef durumu</b>${state.paused ? ` · ⏸ DURDURULDU${state.pause_reason ? ` (${htmlEscape(state.pause_reason)})` : ''}` : ''}`,
    `Harcama: bugün $${spend.today.toFixed(2)} / $${cfg.budgets_usd.daily} · bu ay $${spend.month.toFixed(2)} / $${cfg.budgets_usd.monthly}`,
  ];
  if (products.length) lines.push('', ...products.map(productLine));
  else lines.push('', 'Henüz ürün yok. Keşif turunu bekle ya da /fikir ile bir fikir gönder.');
  const pendingIdeas = Object.values(state.ideas).filter((i) => i.status === 'pending');
  if (pendingIdeas.length) lines.push('', `💡 Karar bekleyen fikir: ${pendingIdeas.length}`);
  const chores = pendingChores(state);
  if (chores.length) lines.push(`🔑 Bekleyen işin: ${chores.length} (/isler)`);
  return lines.join('\n');
}

export function dailyDigest(state: FactoryState, spend: SpendTotals, cfg: SedefConfig, since: string | undefined, now: Date): string {
  const tz = cfg.factory.timezone;
  const date = localParts(now, tz).date;
  const sinceMs = since ? Date.parse(since) : now.getTime() - 86_400_000;
  const products = Object.values(state.products);
  const live = products.filter((p) => p.stage === 'grow' || p.stage === 'launch').length;
  const inReview = products.filter((p) => p.stage === 'release_watch' || p.stage === 'review_fix').length;
  const building = products.filter((p) => !['grow', 'launch', 'release_watch', 'review_fix', 'killed', 'sunset'].includes(p.stage) && p.status !== 'failed').length;

  const lines = [
    `🦪 <b>Sedef · günlük özet</b> (${date})`,
    `Yayında: ${live} · İncelemede: ${inReview} · Hatta: ${building}${state.paused ? ' · ⏸ durduruldu' : ''}`,
  ];

  const moves: string[] = [];
  for (const p of products) {
    for (const e of p.events) {
      if (Date.parse(e.at) < sinceMs) continue;
      if (e.event === 'advance' || e.event === 'failed' || e.event === 'killed' || e.event === 'launched' || e.event === 'parked') {
        moves.push(`• <b>${htmlEscape(p.slug)}</b>: ${htmlEscape(e.note ?? `${stageTr(e.stage)} ${e.event}`)}`);
      }
    }
  }
  if (moves.length) lines.push('', '<b>Bugün olanlar</b>', ...moves.slice(-15));
  else lines.push('', 'Bugün aşama değişikliği yok.');

  const failed = products.filter((p) => p.status === 'failed');
  if (failed.length) lines.push('', '<b>Park edilenler</b>', ...failed.map((p) => `🧯 ${htmlEscape(p.slug)} · ${stageTr(p.stage)} · ${htmlEscape(p.last_error ?? '')}`.slice(0, 300)));

  lines.push('', `Harcama: bugün $${spend.today.toFixed(2)} / $${cfg.budgets_usd.daily} · bu ay $${spend.month.toFixed(2)} / $${cfg.budgets_usd.monthly}`);

  const chores = pendingChores(state);
  if (chores.length) {
    const totalMin = chores.reduce((s, c) => s + (c.minutes ?? 5), 0);
    lines.push('', `<b>Senden beklenenler</b> (${chores.length} iş, ~${totalMin} dk)`, ...chores.slice(0, 8).map(formatChore));
    if (chores.length > 8) lines.push(`…ve ${chores.length - 8} iş daha: /isler`);
  }

  const pendingIdeas = Object.values(state.ideas).filter((i) => i.status === 'pending');
  if (pendingIdeas.length) lines.push('', `💡 Karar bekleyen ${pendingIdeas.length} fikir var (kartlar yukarıda).`);
  lines.push('', `Sonraki keşif: ${cfg.schedules.scout}`);
  return lines.join('\n');
}
