import { describe, expect, it } from 'vitest';
import { RIVER, WATER_AREA, ROAD, foliage, greenway, WIDTHS, MOTION_FRAME_MS } from '../src/map/materials';
import { fieldFragment } from '../src/map/field-shader';
import { WATER_BASE, blueShift, lerpColor, seasonalFoliagePair, TOKENS } from '../src/map/color';

/**
 * 数値は Android 版 MapPaintLayer.kt / OsmMap.kt の直値。
 * どれも作者のフィードバックで決まったもので（「細い線では動きが分からない」「池は騒がしい」
 * 「道はいちばん静かに」）、勝手に動かすとその判断が黙って消える。
 */
describe('material uniforms match MapPaintLayer.kt', () => {
  it('river is the loud one: fine pattern, strong contrast, fastest', () => {
    expect([RIVER.octaves, RIVER.scalePx, RIVER.speed, RIVER.warp, RIVER.gain]).toEqual([3, 30, 1.0, 1.0, 1.45]);
  });

  it('water areas are the same code with calmer values (a wide surface must not boil)', () => {
    expect([WATER_AREA.octaves, WATER_AREA.scalePx, WATER_AREA.speed, WATER_AREA.warp, WATER_AREA.gain])
      .toEqual([2, 110, 0.35, 1.0, 0.75]);
    expect(WATER_AREA.scalePx).toBeGreaterThan(RIVER.scalePx);
    expect(WATER_AREA.gain).toBeLessThan(RIVER.gain);
  });

  it('foliage is slow, and roads are the quietest of all', () => {
    const f = foliage(8);
    expect([f.octaves, f.scalePx, f.speed, f.warp, f.gain]).toEqual([2, 115, 0.14, 0.8, 0.9]);
    expect([ROAD.octaves, ROAD.scalePx, ROAD.speed, ROAD.warp, ROAD.gain]).toEqual([2, 170, 0.06, 0.6, 0.85]);
    expect(ROAD.speed).toBeLessThan(f.speed);
    expect(f.speed).toBeLessThan(RIVER.speed);
  });

  it('greenways share the foliage picture, only more opaque', () => {
    expect(greenway(8).colors).toEqual(foliage(8).colors);
    expect(greenway(8).opacity).toBeGreaterThan(foliage(8).opacity);
  });

  it('keeps the Android line widths and the 120 ms tick', () => {
    expect(WIDTHS).toEqual({ riverBase: 8, riverCore: 4.5, greenway: 15, majorRoad: 7 });
    expect(MOTION_FRAME_MS).toBe(120);
  });
});

describe('field shader (port of the AGSL source)', () => {
  it('bakes the octave count in, because the loop bound must be constant', () => {
    expect(fieldFragment(3)).toContain('i < 3');
    expect(fieldFragment(2)).toContain('i < 2');
  });

  it('keeps the two-stage domain warp with time entering in three places', () => {
    const src = fieldFragment(2);
    expect(src).toContain('0.5 * t');
    expect(src).toContain('0.226 * t');
    expect(src).toContain('0.15 * t');
    expect(src).toContain('0.0226 * t');
  });

  it('mixes three same-family colours with cos-squared weights summing to one', () => {
    const src = fieldFragment(2);
    expect(src).toContain('0.66667');
    expect(src).toContain('0.33333');
    // 画面座標で計算する＝地物は「窓」。ここが地物ローカルになると意味が変わる。
    expect(src).toContain('gl_FragCoord.xy / uDpr');
  });
});

describe('colour derivations', () => {
  it('shifts the cyan towards blue by dropping green (Color.kt blueShift)', () => {
    expect(blueShift('#17A5DB', 0.3)).toBe(WATER_BASE);
    // 緑を 0.7 倍：0xA5(165) → 115.5 → 0x74。色相がおよそ 197° から 213° へ動く。
    expect(WATER_BASE).toBe('#1774DB');
  });

  it('interpolates in Oklab, as Compose does — not in plain sRGB', () => {
    const mid = lerpColor('#000000', '#FFFFFF', 0.5);
    // sRGB のまま混ぜれば #808080。Oklab の中点は知覚的な中間なので、
    // sRGB の数値としてはそれより暗いところに来る。ここが #808080 に戻ったら
    // 補間空間が変わったということ＝派生色すべてがアプリとずれる。
    expect(mid).not.toBe('#808080');
    expect(parseInt(mid.slice(1, 3), 16)).toBeLessThan(0x80);
  });

  it('round-trips the endpoints exactly', () => {
    expect(lerpColor('#5E9E52', '#2A2620', 0)).toBe('#5E9E52');
    expect(lerpColor('#5E9E52', '#2A2620', 1)).toBe('#2A2620');
  });

  it('gives every season a distinct green pair', () => {
    const seasons = [4, 7, 10, 1].map((m) => seasonalFoliagePair(m).join());
    expect(new Set(seasons).size).toBe(4);
  });

  it('never uses the route green for anything but the route', () => {
    // 走行データ以外に彩度色を使わない（§4 色の規律）。道はマスタード系。
    expect(ROAD.colors.join()).not.toContain(TOKENS.routeLine);
    expect(RIVER.colors.join()).not.toContain(TOKENS.routeLine);
  });
});
