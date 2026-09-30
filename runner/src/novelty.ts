/**
 * Novelty ledger: keeps the factory from shipping the same product twice.
 *
 * Every product that passes the brand stage leaves a fingerprint (direction,
 * palette, fonts, icon style, naming pattern, category, mechanic). A new
 * candidate must be far enough from the last N fingerprints — the "judge on
 * distance from past products, not on 'best'" rule.
 */

export interface Fingerprint {
  product: string;
  created_at?: string;
  lane?: string;
  category?: string;
  audience?: string;
  core_mechanic?: string;
  monetization?: string;
  direction: Record<string, string>;
  palette: Record<string, string>;
  fonts: string[];
  icon_style?: string;
  name_pattern?: string;
}

export interface NoveltyConfig {
  threshold: number;
  window: number;
  font_window: number;
  palette_min_delta_e: number;
  weights: Record<string, number>;
}

export interface NoveltyResult {
  pass: boolean;
  min_distance: number | null;
  nearest?: string;
  compared: number;
  violations: string[];
}

export function parseHex(hex: string): [number, number, number] | undefined {
  const h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) return [0, 1, 2].map((i) => parseInt(h[i]! + h[i]!, 16)) as [number, number, number];
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return undefined;
}

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** sRGB hex → OKLab (Björn Ottosson). L is 0..1. */
export function hexToOklab(hex: string): [number, number, number] | undefined {
  const rgb = parseHex(hex);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean distance in OKLab. ~0.02 is a just-noticeable difference; >0.1 reads as a different color. */
export function deltaEOk(a: string, b: string): number | undefined {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  if (!x || !y) return undefined;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

function jaccardDistance(a: string[], b: string[]): number {
  const A = new Set(a.map(norm).filter(Boolean));
  const B = new Set(b.map(norm).filter(Boolean));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

export function distance(a: Fingerprint, b: Fingerprint, weights: Record<string, number>): { total: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {};
  let sum = 0;
  let wsum = 0;
  const add = (key: string, value: number, weight: number) => {
    parts[key] = value;
    sum += value * weight;
    wsum += weight;
  };

  const axes = new Set([...Object.keys(a.direction ?? {}), ...Object.keys(b.direction ?? {})]);
  for (const axis of axes) {
    const va = norm(a.direction?.[axis]);
    const vb = norm(b.direction?.[axis]);
    if (!va || !vb) continue;
    add(`direction.${axis}`, va === vb ? 0 : 1, weights[`direction.${axis}`] ?? weights.direction ?? 1);
  }

  for (const role of ['primary', 'accent', 'background']) {
    const ca = a.palette?.[role];
    const cb = b.palette?.[role];
    if (!ca || !cb) continue;
    const d = deltaEOk(ca, cb);
    if (d === undefined) continue;
    add(`palette.${role}`, Math.min(1, d / 0.3), (weights.palette ?? 1) / 3);
  }

  if ((a.fonts?.length ?? 0) > 0 && (b.fonts?.length ?? 0) > 0) add('fonts', jaccardDistance(a.fonts, b.fonts), weights.fonts ?? 1);

  for (const key of ['icon_style', 'name_pattern', 'category', 'core_mechanic'] as const) {
    const va = norm(a[key]);
    const vb = norm(b[key]);
    if (!va || !vb) continue;
    add(key, va === vb ? 0 : 1, weights[key] ?? 0.5);
  }

  return { total: wsum === 0 ? 1 : sum / wsum, parts };
}

export function checkNovelty(candidate: Fingerprint, ledger: Fingerprint[], cfg: NoveltyConfig): NoveltyResult {
  const violations: string[] = [];
  if (!candidate.direction || Object.keys(candidate.direction).length < 4) violations.push('fingerprint.direction needs at least 4 axes (drawn from the constraint deck)');
  if (!candidate.palette?.primary || !parseHex(candidate.palette.primary)) violations.push('fingerprint.palette.primary must be a hex color');
  if (!candidate.fonts?.length) violations.push('fingerprint.fonts must list the typefaces');

  const others = ledger.filter((f) => f.product !== candidate.product);
  const recent = others.slice(-cfg.window);
  let min: number | null = null;
  let nearest: string | undefined;

  for (const prev of recent) {
    const d = distance(candidate, prev, cfg.weights).total;
    if (min === null || d < min) { min = d; nearest = prev.product; }
    if (d < cfg.threshold) violations.push(`too close to "${prev.product}" (distance ${d.toFixed(2)} < ${cfg.threshold})`);
    const de = candidate.palette?.primary && prev.palette?.primary ? deltaEOk(candidate.palette.primary, prev.palette.primary) : undefined;
    if (de !== undefined && de < cfg.palette_min_delta_e) violations.push(`primary color is nearly identical to "${prev.product}" (ΔE_ok ${de.toFixed(3)} < ${cfg.palette_min_delta_e})`);
  }

  const fontRecent = others.slice(-cfg.font_window);
  for (const font of candidate.fonts ?? []) {
    const user = fontRecent.find((f) => (f.fonts ?? []).some((x) => norm(x) === norm(font)));
    if (user && !isSystemFont(font)) violations.push(`typeface "${font}" was used by "${user.product}" within the last ${cfg.font_window} products`);
  }

  return { pass: violations.length === 0, min_distance: min, ...(nearest ? { nearest } : {}), compared: recent.length, violations };
}

/** Platform UI fonts are allowed as secondary faces; the brand must come from elsewhere. */
function isSystemFont(font: string): boolean {
  return /^(sf pro|sf compact|sf mono|new york|system-ui|roboto|segoe ui)/i.test(font.trim());
}
