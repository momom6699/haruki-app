#!/usr/bin/env node
/**
 * **デモ用**の走行ルートを作る。実利用者の記録は一切使わない（§7）。
 *
 * 道路・緑道のジオメトリからグラフを組み、同じ「家」から出て同じ「家」へ帰る周回を
 * 決定論的に生成する。何度も同じ道を通るので、重ねたときに濃さが自然に出る
 * ——ヒートマップの色分けをしないで密度を出す、というのが Android 版
 * CumulativeRouteMapView と同じ考え方。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { rng } from './lib/geo.mjs';

const SNAP_DEG = 0.00025; // ざっくり25m。頂点をまとめて交差点にする。
const key = (c) => `${Math.round(c[0] / SNAP_DEG)}:${Math.round(c[1] / SNAP_DEG)}`;

/**
 * 線を細かく割ってから丸める。
 *
 * 元の頂点そのままだと、交差する2本の道が交点に頂点を持っていない限り同じ節点にならず、
 * グラフが「つながっていない線の束」になる。そうなると歩き回れず、経路が
 * 1本の線の往復にしかならない。丸め幅の半分より細かく割ってから丸めれば、
 * 実際に交差している場所で必ず同じ節点になる。
 */
function densify(coords, step = SNAP_DEG / 2) {
  const out = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let k = 0; k < n; k++) out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

const area = JSON.parse(readFileSync('public/data/area.geojson', 'utf8'));
const walkable = area.features.filter(
  (f) => f.geometry.type === 'LineString' && (f.properties.kind === 'road' || f.properties.kind === 'greenway'),
);

/** node key -> {coord, neighbours:Set<key>} */
const nodes = new Map();
const touch = (coord) => {
  const k = key(coord);
  if (!nodes.has(k)) nodes.set(k, { coord, neighbours: new Set() });
  return k;
};
for (const f of walkable) {
  const coords = densify(f.geometry.coordinates);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = touch(coords[i]);
    const b = touch(coords[i + 1]);
    if (a === b) continue;
    nodes.get(a).neighbours.add(b);
    nodes.get(b).neighbours.add(a);
  }
}

const R = 6_371_000;
const metres = (a, b) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot(dLat, dLon * Math.cos(lat)) * R;
};

const center = area.center ?? [139.7528, 35.6852];
const home = [...nodes.keys()].sort(
  (a, b) => metres(nodes.get(a).coord, center) - metres(nodes.get(b).coord, center),
)[0];

/** 家までの最短経路（辺数）。帰り道に使う。 */
function pathHome(from) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === home) break;
    for (const n of nodes.get(cur).neighbours) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        queue.push(n);
      }
    }
  }
  if (!prev.has(home)) return [];
  // prev は from からの BFS なので、home から辿ると home→…→from。
  // 帰り道として使うには from→…→home にしたいので、1回だけ反転する。
  const backwards = [];
  for (let c = home; c; c = prev.get(c)) backwards.push(c);
  return backwards.reverse();
}

function makeRoute(random, targetMetres) {
  const visited = [home];
  let current = home;
  let travelled = 0;
  let guard = 0;
  while (travelled < targetMetres * 0.55 && guard++ < 400) {
    const options = [...nodes.get(current).neighbours];
    if (!options.length) break;
    // 直前に来た道へすぐ戻らない（往復のギザギザを避ける）。
    const back = visited[visited.length - 2];
    const forward = options.filter((o) => o !== back);
    const next = (forward.length ? forward : options)[Math.floor(random() * (forward.length || options.length))];
    travelled += metres(nodes.get(current).coord, nodes.get(next).coord);
    visited.push(next);
    current = next;
  }
  const back = pathHome(current);
  const full = [...visited, ...back.slice(1)];
  const coords = full.map((k) => nodes.get(k).coord);
  const deduped = coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
  const distance = deduped.reduce((sum, c, i) => (i ? sum + metres(deduped[i - 1], c) : 0), 0);
  return { coords: deduped, distance };
}

const random = rng(70260831);
const routes = [];
for (let i = 0; routes.length < 34 && i < 400; i++) {
  const target = 3_000 + random() * 11_000;
  const route = makeRoute(random, target);
  if (route.coords.length > 12 && route.distance > 2_000) routes.push(route);
}
routes.sort((a, b) => a.distance - b.distance);

/**
 * 描く前に間引く。グラフを組むために 12.5m 刻みまで割ってあるので、そのまま書き出すと
 * 点が数万になる。Android も保存点はそのまま持ち、**描画時だけ** simplifyRoute で
 * 間引いている（CumulativeRouteMapView）。ここも同じで、形は変えずに点だけ減らす。
 */
function simplify(points, tolerance = 0.00004) {
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

const fc = (list, note) => ({
  type: 'FeatureCollection',
  demo: true,
  note,
  features: list.map((r, i) => ({
    type: 'Feature',
    properties: { index: i, distanceMetres: Math.round(r.distance) },
    geometry: { type: 'LineString', coordinates: simplify(r.coords) },
  })),
});

// ヒーローの1本は、形が読める中くらいの周回を選ぶ。
const hero = routes[Math.floor(routes.length * 0.6)];
writeFileSync('public/data/route-hero.geojson', JSON.stringify(fc([hero], 'demo fixture — not real user data')));
writeFileSync('public/data/routes-cumulative.geojson', JSON.stringify(fc(routes, 'demo fixture — not real user data')));
console.log(
  `wrote route-hero.geojson (${(hero.distance / 1000).toFixed(1)} km, ${hero.coords.length} pts) ` +
    `and routes-cumulative.geojson (${routes.length} routes, ` +
    `${(routes.reduce((s, r) => s + r.distance, 0) / 1000).toFixed(0)} km total)`,
);
