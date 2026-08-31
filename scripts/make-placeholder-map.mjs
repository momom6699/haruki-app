#!/usr/bin/env node
/**
 * **仮の地物**を作る。実データが来るまでの置き換え前提のもの。
 *
 * このサンドボックスからは Overpass へ到達できないため、レイアウトとシェーダを検証する
 * ためだけの合成ジオメトリを置く。実在の土地の形ではない。実データが用意でき次第、
 *   node scripts/build-map-fixture.mjs <overpass.json>
 * で上書きする（スキーマは同じ）。
 */
import { writeFileSync } from 'node:fs';
import { rng, offsetToLatLon, toCoord, smooth } from './lib/geo.mjs';

const CENTER = { lat: 35.6852, lon: 139.7528 };
const EXTENT = 3600;
const random = rng(20260831);

const P = (o) => offsetToLatLon(CENTER, o.east, o.north);
const line = (offsets, kind) => ({
  type: 'Feature',
  properties: { kind },
  geometry: { type: 'LineString', coordinates: offsets.map((o) => toCoord(P(o))) },
});
const area = (offsets, kind) => {
  const ring = offsets.map((o) => toCoord(P(o)));
  ring.push(ring[0]);
  return { type: 'Feature', properties: { kind }, geometry: { type: 'Polygon', coordinates: [ring] } };
};

/** ゆらぎのある閉じた面。真円だと人工物に見える。 */
function blob(cx, cy, radius, wobble, points = 26) {
  const phase = random() * Math.PI * 2;
  return Array.from({ length: points }, (_, i) => {
    const t = (i / points) * Math.PI * 2;
    const r = radius * (1 + wobble * (Math.sin(t * 3 + phase) * 0.5 + Math.sin(t * 5 + phase * 2) * 0.3));
    return { east: cx + Math.cos(t) * r, north: cy + Math.sin(t) * r * 0.86 };
  });
}

const features = [];

// 川：南西から北東へ。緑道はこれに沿わせる。
const riverSpine = smooth(
  Array.from({ length: 11 }, (_, i) => {
    const u = i / 10;
    return { east: -EXTENT + u * EXTENT * 2, north: -1200 + u * 2000 + Math.sin(u * 5.2) * 420 };
  }),
  10,
);
features.push(line(riverSpine, 'river'));
features.push(line(riverSpine.map((p) => ({ east: p.east + 34, north: p.north - 44 })), 'greenway'));

// 道：碁盤ではなく、間隔と向きに少しずつ差のある街路網。
const STEP = 330;
const count = Math.ceil(EXTENT / STEP);
for (let i = -count; i <= count; i++) {
  const base = i * STEP + (random() - 0.5) * 90;
  const bend = 26 + random() * 34;
  const freq = 900 + random() * 900;
  const phase = random() * Math.PI * 2;
  features.push(
    line(
      Array.from({ length: 26 }, (_, k) => {
        const north = -EXTENT + (k / 25) * EXTENT * 2;
        return { east: base + Math.sin(north / freq + phase) * bend, north };
      }),
      'road',
    ),
  );
}
for (let i = -count; i <= count; i++) {
  const base = i * STEP + (random() - 0.5) * 90;
  const bend = 24 + random() * 32;
  const freq = 850 + random() * 900;
  const phase = random() * Math.PI * 2;
  features.push(
    line(
      Array.from({ length: 26 }, (_, k) => {
        const east = -EXTENT + (k / 25) * EXTENT * 2;
        return { east, north: base + Math.sin(east / freq + phase) * bend };
      }),
      'road',
    ),
  );
}
// 斜めの大通りを2本。格子だけだと網に見える。
for (const [a, b] of [
  [{ east: -EXTENT, north: EXTENT * 0.55 }, { east: EXTENT, north: -EXTENT * 0.75 }],
  [{ east: -EXTENT * 0.85, north: -EXTENT }, { east: EXTENT * 0.6, north: EXTENT }],
]) {
  features.push(
    line(
      Array.from({ length: 24 }, (_, k) => {
        const u = k / 23;
        return {
          east: a.east + (b.east - a.east) * u + Math.sin(u * 6) * 40,
          north: a.north + (b.north - a.north) * u + Math.cos(u * 5) * 40,
        };
      }),
      'road',
    ),
  );
}

// 緑地：大きな公園ひとつと、小さな緑地を散らす。池は公園の内側に。
const parkC = { east: -240, north: 320 };
features.push(area(blob(parkC.east, parkC.north, 620, 0.16), 'park'));
features.push(area(blob(parkC.east + 120, parkC.north - 90, 175, 0.22), 'water'));
features.push(line(blob(parkC.east, parkC.north, 665, 0.14, 44), 'greenway'));
for (const [e, n, r] of [
  [1500, -1250, 330], [-1850, -1500, 260], [2100, 1500, 300],
  [-1600, 1650, 230], [700, 2200, 200], [-2600, 500, 210], [2700, -300, 240],
]) {
  features.push(area(blob(e, n, r, 0.2), 'park'));
}
features.push(area(blob(1520, -1230, 105, 0.24), 'water'));

const geojson = {
  type: 'FeatureCollection',
  attribution: '合成データ（仮） — synthetic placeholder, not real OpenStreetMap geometry',
  placeholder: true,
  center: [CENTER.lon, CENTER.lat],
  features,
};
writeFileSync('public/data/area.geojson', JSON.stringify(geojson));
const counts = features.reduce((a, f) => ((a[f.properties.kind] = (a[f.properties.kind] ?? 0) + 1), a), {});
console.log('wrote public/data/area.geojson (PLACEHOLDER):', counts);
