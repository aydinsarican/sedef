import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNovelty, deltaEOk, distance, hexToOklab, parseHex, type Fingerprint } from '../src/novelty.js';

const cfg = {
  threshold: 0.45,
  window: 12,
  font_window: 6,
  palette_min_delta_e: 0.08,
  weights: { direction: 1, palette: 1.5, fonts: 1.2, icon_style: 0.8, name_pattern: 0.5, category: 0.6, core_mechanic: 0.6 },
};

const fp = (product: string, over: Partial<Fingerprint> = {}): Fingerprint => ({
  product,
  category: 'habit',
  core_mechanic: 'streaks',
  direction: { era: 'swiss-1960s', material: 'paper', typeface_class: 'grotesque', color_model: 'duotone', grid: 'modular', motion: 'snappy-mechanical' },
  palette: { primary: '#E4572E', accent: '#17BEBB', background: '#FFF8F0' },
  fonts: ['Space Grotesk', 'SF Pro'],
  icon_style: 'flat-glyph',
  name_pattern: 'coined',
  ...over,
});

test('hex parsing and OKLab conversion', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#0a0B0c'), [10, 11, 12]);
  assert.equal(parseHex('nope'), undefined);
  const white = hexToOklab('#FFFFFF')!;
  const black = hexToOklab('#000000')!;
  assert.ok(Math.abs(white[0] - 1) < 1e-3 && Math.abs(white[1]) < 1e-3 && Math.abs(white[2]) < 1e-3);
  assert.ok(Math.abs(black[0]) < 1e-9);
  assert.equal(deltaEOk('#123456', '#123456'), 0);
  assert.ok(deltaEOk('#FF0000', '#00FF00')! > 0.3);
  assert.ok(deltaEOk('#E4572E', '#E5582F')! < 0.02);
});

test('identical fingerprints have zero distance; different ones are far', () => {
  assert.equal(distance(fp('a'), fp('b'), cfg.weights).total, 0);
  const other = fp('c', {
    category: 'finance',
    core_mechanic: 'envelopes',
    direction: { era: 'y2k', material: 'chrome', typeface_class: 'wide-display', color_model: 'neon-on-dark', grid: 'free', motion: 'bouncy-organic' },
    palette: { primary: '#6B4EFF', accent: '#00F5A0', background: '#0B0B12' },
    fonts: ['Unbounded', 'Inter Tight'],
    icon_style: '3d-clay',
    name_pattern: 'real-word',
  });
  assert.ok(distance(fp('a'), other, cfg.weights).total > 0.9);
});

test('novelty check flags a near-duplicate, a reused font and a reused primary color', () => {
  const ledger = [fp('prev-1')];
  const clone = checkNovelty(fp('new'), ledger, cfg);
  assert.equal(clone.pass, false);
  assert.ok(clone.violations.some((v) => v.includes('too close')));
  assert.ok(clone.violations.some((v) => v.includes('Space Grotesk')));
  assert.ok(clone.violations.some((v) => v.includes('primary color')));
  assert.equal(clone.nearest, 'prev-1');
});

test('novelty check passes a genuinely different product and allows system fonts', () => {
  const ledger = [fp('prev-1')];
  const fresh = fp('new', {
    category: 'travel',
    core_mechanic: 'collections',
    direction: { era: 'art-deco', material: 'enamel', typeface_class: 'didone', color_model: 'jewel-tones', grid: 'axial', motion: 'slow-cinematic' },
    palette: { primary: '#0F5257', accent: '#D4AF37', background: '#F2EDE4' },
    fonts: ['Playfair Display', 'SF Pro'],
    icon_style: 'line-engraving',
    name_pattern: 'foreign-word',
  });
  const res = checkNovelty(fresh, ledger, cfg);
  assert.deepEqual(res.violations, []);
  assert.equal(res.pass, true);
});

test('re-branding the same product is not compared against itself', () => {
  assert.equal(checkNovelty(fp('same'), [fp('same')], cfg).pass, true);
});

test('fingerprint completeness is enforced', () => {
  const res = checkNovelty({ product: 'x', direction: { era: 'a' }, palette: {}, fonts: [] }, [], cfg);
  assert.equal(res.pass, false);
  assert.equal(res.violations.length, 3);
});
