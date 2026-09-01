#!/usr/bin/env node
/**
 * **仮の地物**を作る。実データが来るまでの置き換え前提のもの。
 *
 * このサンドボックスからは Overpass へ到達できないため、レイアウトとシェーダを確かめる
 * ための合成ジオメトリを置く。実在の土地の形ではない。実データが用意でき次第、
 *   node scripts/build-map-fixture.mjs <overpass.json>
 * で上書きする（スキーマは同じ）。
 *
 * 街に見せるための作り:
 *  - 一枚の方眼にしない。**区ごとに向きと間隔の違う街路網**を置く。実際の都市が
 *    そう見えるのは、時代の違う区画が角度を変えて隣り合っているからで、
 *    端から端まで通る格子を敷くと方眼紙にしか見えない。
 *  - 道は途中で始まり途中で終わる。区の輪郭で切る。
 *  - 大通りだけが区をまたいで通り、川と公園がその上に乗る。
 */
import { writeFileSync } from 'node:fs';
import { rng, offsetToLatLon, toCoord, smooth } from './lib/geo.mjs';

const CENTER = { lat: 35.6845, lon: 139.753 };
const EXTENT = 3600;
const random = rng(20260901);

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

/* --- 区ごとの街路網 ------------------------------------------------------
   中心 (cx,cy) と半径 r の円の中だけに、角度 angle・間隔 step の平行線を2方向へ引く。
   円で切るので道は途中で終わる。区ごとに角度を変えると、境目で向きが食い違う。 */
function district(cx, cy, r, angle, step) {
  for (const dir of [0, Math.PI / 2]) {
    const a = angle + dir;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // 法線方向にずらしながら、円の弦を引く。
    for (let d = -r; d <= r; d += step) {
      const half = Math.sqrt(Math.max(r * r - d * d, 0));
      if (half < step * 0.7) continue; // 端の短すぎる弦は落とす
      const nx = -uy * d;
      const ny = ux * d;
      const jitter = (random() - 0.5) * step * 0.22;
      const bend = (random() - 0.5) * 46;
      const pts = Array.from({ length: 9 }, (_, k) => {
        const t = -half + (k / 8) * half * 2;
        const curve = Math.sin((t / half) * Math.PI) * bend;
        return {
          east: cx + nx + ux * t + -uy * curve + jitter,
          north: cy + ny + uy * t + ux * curve + jitter,
        };
      });
      features.push(line(pts, 'road'));
    }
  }
}

// 時代の違う区画が角度を変えて隣り合う。間隔も少しずつ違える。
district(-620, 380, 1180, 0.06, 300);
district(1250, -820, 1080, 0.62, 330);
district(-1650, -1180, 980, -0.38, 290);
district(1600, 1250, 950, 0.28, 340);
district(-2250, 1500, 820, 0.95, 360);
district(2450, 300, 900, -0.15, 315);

// 区をまたぐ大通り。街のつなぎ目はこれが担う。
for (const [a, b] of [
  [{ east: -EXTENT, north: 620 }, { east: EXTENT, north: -980 }],
  [{ east: -EXTENT * 0.9, north: -EXTENT }, { east: EXTENT * 0.7, north: EXTENT }],
  [{ east: -300, north: -EXTENT }, { east: 400, north: EXTENT }],
]) {
  features.push(
    line(
      Array.from({ length: 30 }, (_, k) => {
        const u = k / 29;
        return {
          east: a.east + (b.east - a.east) * u + Math.sin(u * 5.5) * 90,
          north: a.north + (b.north - a.north) * u + Math.cos(u * 4.5) * 90,
        };
      }),
      'road',
    ),
  );
}

// 川：蛇行して南西から北東へ。緑道を片岸に沿わせる。
const riverSpine = smooth(
  Array.from({ length: 12 }, (_, i) => {
    const u = i / 11;
    return {
      east: -EXTENT + u * EXTENT * 2,
      north: -1500 + u * 2300 + Math.sin(u * 6.1) * 520 + Math.sin(u * 13) * 120,
    };
  }),
  10,
);
features.push(line(riverSpine, 'river'));
features.push(line(riverSpine.map((p) => ({ east: p.east + 38, north: p.north - 52 })), 'greenway'));

// 緑地：大きな公園ひとつと、小さな緑地を散らす。池は公園の内側に。
const parkC = { east: -240, north: 340 };
features.push(area(blob(parkC.east, parkC.north, 640, 0.17), 'park'));
features.push(area(blob(parkC.east + 140, parkC.north - 110, 185, 0.22), 'water'));
features.push(line(blob(parkC.east, parkC.north, 690, 0.15, 44), 'greenway'));
for (const [e, n, r] of [
  [1560, -1300, 340], [-1900, -1560, 270], [2150, 1520, 310],
  [-1680, 1700, 240], [760, 2250, 205], [-2700, 520, 215], [2750, -320, 250],
]) {
  features.push(area(blob(e, n, r, 0.2), 'park'));
}
features.push(area(blob(1580, -1280, 110, 0.24), 'water'));

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
