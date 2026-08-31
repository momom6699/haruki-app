import { describe, expect, it } from 'vitest';
import {
  isGreenAreaTag,
  isWaterAreaTag,
  isMajorRoad,
  isRiverLine,
  isGreenway,
  seaBandFromCoastline,
  keepDrawableAreas,
  overpassToGeoJSON,
  MAX_AREAS_PER_KIND,
} from '../scripts/lib/osm-classify.mjs';

/**
 * 分類は Android 版 OsmMap.kt の写し。ここがずれると、Web とアプリで
 * 「公園とは何か」が食い違う——地図を見ても「元々そこに無い」のと区別が付かないので、
 * テストでしか気付けない類の壊れ方をする。
 */
describe('OSM classification (port of OsmMap.kt)', () => {
  it('accepts every green tag the app accepts', () => {
    for (const tags of [
      { leisure: 'park' }, { leisure: 'garden' }, { leisure: 'nature_reserve' }, { leisure: 'recreation_ground' },
      { landuse: 'forest' }, { landuse: 'grass' }, { landuse: 'meadow' }, { landuse: 'recreation_ground' },
      { landuse: 'village_green' }, { natural: 'wood' }, { natural: 'scrub' }, { natural: 'grassland' },
    ]) {
      expect(isGreenAreaTag(tags), JSON.stringify(tags)).toBe(true);
    }
  });

  it('does not treat a pitch as green (it is not natural, and usually sits inside a park)', () => {
    expect(isGreenAreaTag({ leisure: 'pitch' })).toBe(false);
  });

  it('separates water areas from river lines', () => {
    expect(isWaterAreaTag({ natural: 'water' })).toBe(true);
    expect(isWaterAreaTag({ waterway: 'riverbank' })).toBe(true);
    expect(isWaterAreaTag({ waterway: 'river' })).toBe(false);
    for (const w of ['river', 'stream', 'canal', 'drain']) expect(isRiverLine({ waterway: w })).toBe(true);
  });

  it('keeps only roads wide enough to run on', () => {
    for (const h of ['primary', 'secondary', 'tertiary']) expect(isMajorRoad({ highway: h })).toBe(true);
    // residential まで入れると住宅地の路地が全部乗って下地と区別が付かなくなる。
    for (const h of ['residential', 'service', 'unclassified']) expect(isMajorRoad({ highway: h })).toBe(false);
  });

  it('limits greenways to cycleways and paths actually named as one', () => {
    expect(isGreenway({ highway: 'cycleway' })).toBe(true);
    expect(isGreenway({ highway: 'footway', name: '目黒川緑道' })).toBe(true);
    expect(isGreenway({ highway: 'path', name: 'Riverside Greenway' })).toBe(true);
    expect(isGreenway({ highway: 'footway', name: '駅前歩道' })).toBe(false);
    expect(isGreenway({ highway: 'footway' })).toBe(false);
  });

  it('drops areas too small to paint and caps how many are kept', () => {
    const tiny = [{ lat: 35.65, lon: 139.66 }, { lat: 35.6501, lon: 139.66 }, { lat: 35.6501, lon: 139.6601 }];
    expect(keepDrawableAreas([tiny])).toHaveLength(0);

    const big = (i: number) => {
      const d = 0.004 + i * 1e-6;
      return [
        { lat: 35.65, lon: 139.66 }, { lat: 35.65 + d, lon: 139.66 },
        { lat: 35.65 + d, lon: 139.66 + d }, { lat: 35.65, lon: 139.66 + d },
      ];
    };
    expect(keepDrawableAreas(Array.from({ length: 400 }, (_, i) => big(i)))).toHaveLength(MAX_AREAS_PER_KIND);
  });
});

describe('seaBandFromCoastline', () => {
  // OSM は海を面として持たない。約束は「海岸線の進行方向に対して右が水」。
  it('offsets to the right of travel, and closes the ring', () => {
    const line = [{ lat: 35.0, lon: 139.0 }, { lat: 35.01, lon: 139.0 }]; // due north
    const band = seaBandFromCoastline(line, 1000);
    expect(band).toHaveLength(4);
    // 北へ進むとき右は東＝経度が増える側。
    expect(band[2].lon).toBeGreaterThan(139.0);
    expect(band[3].lon).toBeGreaterThan(139.0);
  });

  it('returns nothing for a degenerate line', () => {
    expect(seaBandFromCoastline([{ lat: 1, lon: 1 }])).toHaveLength(0);
  });
});

describe('overpassToGeoJSON', () => {
  const ring = (lat = 35.65, lon = 139.66, span = 300) => {
    const d = span / 111_000;
    return [
      { lat, lon }, { lat: lat + d, lon }, { lat: lat + d, lon: lon + d }, { lat, lon: lon + d }, { lat, lon },
    ];
  };

  it('routes each element to the layer the app would paint it on', () => {
    const fc = overpassToGeoJSON({
      elements: [
        { type: 'way', tags: { leisure: 'park' }, geometry: ring() },
        { type: 'way', tags: { natural: 'water' }, geometry: ring(35.66) },
        { type: 'way', tags: { highway: 'primary' }, geometry: ring(35.67) },
        { type: 'way', tags: { waterway: 'river' }, geometry: ring(35.68) },
        { type: 'way', tags: { highway: 'cycleway' }, geometry: ring(35.69) },
        { type: 'way', tags: { highway: 'residential' }, geometry: ring(35.70) },
      ],
    });
    const kinds = fc.features.map((f: GeoJSON.Feature) => f.properties!.kind).sort();
    expect(kinds).toEqual(['greenway', 'park', 'river', 'road', 'water']);
  });

  it('draws sea below everything else', () => {
    const fc = overpassToGeoJSON({
      elements: [
        { type: 'way', tags: { leisure: 'park' }, geometry: ring() },
        { type: 'way', tags: { natural: 'coastline' }, geometry: ring(35.66, 139.7, 900) },
      ],
    });
    expect(fc.features[0].properties.kind).toBe('sea');
  });
});
