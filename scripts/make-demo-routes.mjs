#!/usr/bin/env node
/**
 * **デモ用**の走行ルートを作る。実利用者の記録は一切使わない（§7）。
 *
 *   node scripts/make-demo-routes.mjs
 *
 * 皇居の一周は内堀通りの歩道をたどる約5kmで、走る人はここを反時計回りに回る。
 * ルートは思いつきの曲線ではなく、`scripts/lib/kokyo.mjs` の内堀通り中心線を
 * **濠側の歩道ぶんだけ内へ寄せた線**そのもの。だから公園・濠・道と正しく噛み合う。
 *
 * 実際の記録に見せるために足したのは2つだけ：
 *  - GPS のふらつき。白色雑音ではなく、数十メートル周期の**滑らかなうねり**にする
 *    ——受信機の誤差は隣り合う点で相関するので、白色雑音にすると毛羽立って嘘になる。
 *  - 発着の枝。皇居ランは駅やロッカーから通いで来るので、一周だけの線にはならない。
 *    枝は毎回同じ道を通るから、重ねると幹線だけが濃くなる（Android の軌跡と同じ見え方）。
 */
import { writeFileSync } from 'node:fs';
import { rng } from './lib/geo.mjs';
import { LOOP, coord, lengthOf, loopRing, resample, rightNormals, toXY } from './lib/kokyo.mjs';

const random = rng(70260902);

/** 濠側の歩道。中心線から内（＝右）へ11m。 */
const ring = loopRing();
const normals = rightNormals(ring);
const sidewalk = resample(
  ring.map((p, i) => ({ east: p.east + normals[i].east * 11, north: p.north + normals[i].north * 11 })),
  8,
);
const stationIndex = (name) => {
  const s = LOOP.find((x) => x.name === name);
  const target = toXY(s.lat, s.lon);
  let best = 0;
  let bestD = Infinity;
  sidewalk.forEach((p, i) => {
    const d = Math.hypot(p.east - target.east, p.north - target.north);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
};

/**
 * 駅・ロッカーから周回へ入る枝。皇居ランはたいてい通いなので、
 * 行きと帰りで同じ道を通る——重なった線が濃くなるのはこのため。
 */
const APPROACHES = [
  { from: [[35.6748, 139.7601], [35.6752, 139.758], [35.6752, 139.7562]], gate: '祝田橋' },
  { from: [[35.6812, 139.7669], [35.6818, 139.7638], [35.6821, 139.7609]], gate: '和田倉門' },
  { from: [[35.6866, 139.7661], [35.6864, 139.7628], [35.6862, 139.7596]], gate: '大手門' },
  { from: [[35.6906, 139.7592]], gate: '竹橋' },
  { from: [[35.6857, 139.742], [35.6855, 139.7434]], gate: '半蔵門' },
  { from: [[35.6957, 139.7517], [35.6934, 139.7501], [35.6914, 139.7488]], gate: '千鳥ヶ淵交差点' },
  { from: [[35.6959, 139.7578], [35.6934, 139.7583], [35.6913, 139.7588]], gate: '竹橋' },
  { from: [[35.6751, 139.7636], [35.6748, 139.7606], [35.6754, 139.7583]], gate: '日比谷' },
  { from: [[35.6785, 139.7405], [35.6791, 139.7438], [35.6796, 139.746]], gate: '三宅坂' },
];

/**
 * 滑らかなうねり。周期の違う正弦をいくつか重ねる——隣り合う点で誤差が相関する、
 * という受信機のふるまいだけを写す。
 */
function wobble(amplitude, waves = 4) {
  const parts = Array.from({ length: waves }, () => ({
    period: 40 + random() * 220,
    phase: random() * Math.PI * 2,
    gain: 0.35 + random() * 0.65,
  }));
  const norm = parts.reduce((s, p) => s + p.gain, 0);
  return (metres) =>
    (amplitude / norm) * parts.reduce((s, p) => s + p.gain * Math.sin((metres / p.period) * Math.PI * 2 + p.phase), 0);
}

/** 線に沿ってふらつきを乗せる。横（歩道の幅の中）を主に、縦は歩幅ぶんだけ。 */
function jitter(points, lateral = 3.4, bias = 0) {
  const across = wobble(lateral);
  const along = wobble(1.2);
  let travelled = 0;
  return points.map((p, i) => {
    if (i) travelled += Math.hypot(p.east - points[i - 1].east, p.north - points[i - 1].north);
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const tx = b.east - a.east;
    const ty = b.north - a.north;
    const len = Math.hypot(tx, ty) || 1;
    const nx = ty / len;
    const ny = -tx / len;
    const off = across(travelled) + bias;
    return {
      east: p.east + nx * off + (tx / len) * along(travelled),
      north: p.north + ny * off + (ty / len) * along(travelled),
    };
  });
}

/** 周回を laps 周ぶん、gate から。反時計回りなら線を逆に辿る。 */
function laps(gate, count, counterClockwise) {
  const n = sidewalk.length;
  const at = stationIndex(gate);
  const out = [];
  for (let k = 0; k < Math.round(count * n); k++) {
    const i = counterClockwise ? (at - k + n * (Math.ceil(count) + 1)) % n : (at + k) % n;
    out.push(sidewalk[i]);
  }
  return out;
}

function makeRun({ gate, count, counterClockwise, approach }) {
  const spur = approach ? resample(approach.from.map(([lat, lon]) => toXY(lat, lon)), 8) : [];
  const inbound = spur.slice();
  const outbound = spur.slice().reverse();
  const raw = [...inbound, ...laps(gate, count, counterClockwise), ...outbound];
  const points = jitter(raw, 2.6 + random() * 1.8, (random() - 0.5) * 3.2);
  return { points, distance: lengthOf(points) };
}

/* --- 一本（ヒーロー）------------------------------------------------------- */

// 桜田門から反時計回りに一周。皇居ランの作法どおり。
const hero = makeRun({ gate: '桜田門', count: 1, counterClockwise: true, approach: null });

/* --- 積み重ね -------------------------------------------------------------- */

const runs = [];
for (let i = 0; i < 34; i++) {
  const approach = APPROACHES[Math.floor(random() * APPROACHES.length)];
  // 1周が基本、たまに2〜4周。ロング走ほど数が少ないのは実際の走り方に合わせて。
  const roll = random();
  const count = roll < 0.46 ? 1 : roll < 0.78 ? 2 : roll < 0.94 ? 3 : 4;
  runs.push(
    makeRun({
      gate: approach.gate,
      count,
      counterClockwise: random() < 0.82, // 時計回りに回る日もある
      approach,
    }),
  );
}
runs.sort((a, b) => a.distance - b.distance);

/**
 * 描く前に間引く。Android も保存点はそのまま持ち、**描画時だけ** simplifyRoute で
 * 間引いている（CumulativeRouteMapView）。ここも同じで、形は変えずに点だけ減らす。
 *
 * 許容はその地図の縮尺に合わせる。ヒーローは寄った絵なので 1.5m 相当まで残し、
 * 積み重ねは1画面に5kmが収まる縮尺（1px≒10m）なので 6m 相当で足りる
 * ——見えない細かさを34本ぶん持つと、それだけで fixture が10倍に膨れる。
 */
const HERO_TOLERANCE = 0.000014;
const CUMULATIVE_TOLERANCE = 0.000055;

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let far = tolerance;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const fc = (list, note, tolerance) => ({
  type: 'FeatureCollection',
  demo: true,
  note,
  features: list.map((r, i) => ({
    type: 'Feature',
    properties: { index: i, distanceMetres: Math.round(r.distance) },
    geometry: { type: 'LineString', coordinates: simplify(r.points.map(coord), tolerance) },
  })),
});

const NOTE = 'demo fixture — not real user data（皇居一周・デモ）';
writeFileSync('public/data/route-hero.geojson', JSON.stringify(fc([hero], NOTE, HERO_TOLERANCE)));
writeFileSync('public/data/routes-cumulative.geojson', JSON.stringify(fc(runs, NOTE, CUMULATIVE_TOLERANCE)));
console.log(
  `wrote route-hero.geojson (${(hero.distance / 1000).toFixed(2)} km, ` +
    `${simplify(hero.points.map(coord), HERO_TOLERANCE).length} pts) and routes-cumulative.geojson ` +
    `(${runs.length} runs, ${(runs.reduce((s, r) => s + r.distance, 0) / 1000).toFixed(0)} km total, ` +
    `${(runs[0].distance / 1000).toFixed(1)}–${(runs[runs.length - 1].distance / 1000).toFixed(1)} km)`,
);
