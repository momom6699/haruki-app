/**
 * 皇居周辺の地物を**手で起こす**ためのデータと道具。
 *
 * このサンドボックスから Overpass へは到達できない（タイル・Overpass・Nominatim すべて遮断）。
 * 一方で LP が見せる場所は皇居のまわりだけと決まっているので、合成の街を作るのをやめ、
 * **実在の交差点・門・濠の座標から実際の形を起こす**ことにした。
 *
 * ここに入っている座標は、地図上の目印（門・交差点・駅）から取った概形で、
 * OSM から取り出したものではない。誤差は数十メートルの単位で残る。
 * 実データが用意でき次第
 *   node scripts/build-map-fixture.mjs <overpass.json>
 * で上書きできる（スキーマは同じ）。帰属表示にもそう出す——出どころを偽らない。
 *
 * ## 濠の作り方
 * 濠を1つずつ多角形で置くと、隣り合う濠の幅や向きが揃わず「水たまりの列」になる。
 * 実際の内堀は**内堀通りに沿って一周する1本の帯**で、門のところで土手に切られている。
 * なので通りの中心線を1本持ち、そこから内側へ `inset`（岸までの距離）と `width`（濠の幅）
 * だけずらした2本の岸を作り、その間を濠として塗る。幅は区間ごとに変える
 * ——桜田濠は100m級、乾濠は40m級で、この差が皇居の地図の見え方を決めている。
 */
import { latLonToOffset, offsetToLatLon } from './geo.mjs';

export const CENTER = { lat: 35.6852, lon: 139.7528 };

export const toXY = (lat, lon) => latLonToOffset(CENTER, { lat, lon });
export const toLL = (o) => offsetToLatLon(CENTER, o.east, o.north);
export const coord = (o) => {
  const p = toLL(o);
  return [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))];
};
export const ll = (lat, lon) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))];

/**
 * 内堀通りの中心線（時計回り）。ランナーが走るのはこの歩道で、一周およそ5km。
 *
 * `inset` は通りの中心から濠の手前岸まで、`width` はそこからの濠の幅（m）。
 * 濠は通りの全周に沿っているが、幅は区間ごとにまるで違う——桜田濠は100m級、
 * 乾濠は40m級で、この差が皇居の地図の見え方を決めている。
 *
 * 濠の内側がぜんぶ皇居の森というわけではない。東側では**皇居外苑**（黒松と芝の広場）が
 * 濠と宮殿のあいだに広がっていて、その境目はさらに内側の濠（桔梗濠・蛤濠・二重橋濠）。
 * これは別に置く（[INNER_MOAT_CHAIN]）。
 */
export const LOOP = [
  { name: '桜田門', lat: 35.6773, lon: 139.7524, inset: 24, width: 112, moat: '桜田濠' },
  { name: '三宅坂', lat: 35.6797, lon: 139.747, inset: 22, width: 104, moat: '桜田濠' },
  { name: '国立劇場前', lat: 35.6822, lon: 139.7444, inset: 20, width: 86, moat: '桜田濠' },
  { name: '半蔵門', lat: 35.6853, lon: 139.7443, inset: 20, width: 58, moat: '半蔵濠' },
  { name: '英国大使館前', lat: 35.6877, lon: 139.7455, inset: 20, width: 78, moat: '千鳥ヶ淵' },
  { name: '千鳥ヶ淵交差点', lat: 35.6903, lon: 139.7481, inset: 26, width: 68, moat: '千鳥ヶ淵' },
  { name: '代官町', lat: 35.6907, lon: 139.7516, inset: 30, width: 42, moat: '乾濠' },
  { name: '北桔橋門', lat: 35.6911, lon: 139.7551, inset: 24, width: 48, moat: '平川濠' },
  { name: '竹橋', lat: 35.6901, lon: 139.7583, inset: 26, width: 62, moat: '大手濠' },
  { name: '大手門', lat: 35.6862, lon: 139.7578, inset: 30, width: 56, moat: '桔梗濠' },
  { name: '和田倉門', lat: 35.6822, lon: 139.7593, inset: 26, width: 54, moat: '和田倉濠' },
  { name: '日比谷', lat: 35.6759, lon: 139.7588, inset: 22, width: 72, moat: '日比谷濠' },
  { name: '祝田橋', lat: 35.6752, lon: 139.7549, inset: 28, width: 58, moat: '凱旋濠' },
];

/** 閉じた点列を Catmull-Rom でなめらかに。数値の欄はまとめて補間する（inset/width も一緒に運ぶ）。 */
export function catmullClosed(points, perSegment, fields) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const o = {};
      for (const f of fields) {
        const [a, b, c, d] = [p0[f], p1[f], p2[f], p3[f]];
        o[f] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      }
      // 区間の名前は手前の駅から引き継ぐ（補間できないので）。
      o.moat = p1.moat;
      o.name = p1.name;
      out.push(o);
    }
  }
  return out;
}

/** 閉じた点列の各点で、進行方向の**右**を向く単位法線。時計回りに置いてあるので右が皇居の側。 */
export function rightNormals(ring) {
  const n = ring.length;
  return ring.map((_, i) => {
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const tx = b.east - a.east;
    const ty = b.north - a.north;
    const len = Math.hypot(tx, ty) || 1;
    return { east: ty / len, north: -tx / len };
  });
}

/** 内堀通りの中心線を細かくしたもの（inset/width つき）。地物にもルートにも同じ線を使う。 */
export function loopRing(perSegment = 14) {
  const stations = LOOP.map((s) => ({ ...s, ...toXY(s.lat, s.lon) }));
  return catmullClosed(stations, perSegment, ['east', 'north', 'inset', 'width']);
}

/** 線を等間隔に打ち直す。GPS の点は時間で並ぶので、距離で等間隔にしておくと自然に見える。 */
export function resample(points, stepMetres) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.east - a.east, b.north - a.north);
    if (seg === 0) continue;
    let d = stepMetres - carry;
    while (d <= seg) {
      const u = d / seg;
      out.push({ east: a.east + (b.east - a.east) * u, north: a.north + (b.north - a.north) * u });
      d += stepMetres;
    }
    carry = seg - (d - stepMetres);
  }
  return out;
}

/** 点列の長さ（m）。 */
export const lengthOf = (points) =>
  points.reduce((sum, p, i) => (i ? sum + Math.hypot(p.east - points[i - 1].east, p.north - points[i - 1].north) : 0), 0);

/**
 * 皇居外苑と宮殿の敷地を分ける内側の濠（大手門の西から桜田門まで、桔梗濠・蛤濠・二重橋濠）。
 * 外側の濠と違って内堀通りに沿っていないので、通りの帯とは別に置く。
 */
export const INNER_MOAT_CHAIN = [
  [35.6861, 139.7571], [35.6848, 139.7562], [35.683, 139.7552],
  [35.681, 139.7543], [35.6791, 139.7535], [35.6777, 139.7528],
];

/** 折れ線の両側へ width/2 だけ広げて帯（多角形）にする。 */
export function band(points, width) {
  const left = [];
  const right = [];
  points.forEach((p, i) => {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    const tx = b.east - a.east;
    const ty = b.north - a.north;
    const len = Math.hypot(tx, ty) || 1;
    const nx = (ty / len) * (width / 2);
    const ny = (-tx / len) * (width / 2);
    left.push({ east: p.east + nx, north: p.north + ny });
    right.push({ east: p.east - nx, north: p.north - ny });
  });
  return [...left, ...right.reverse()];
}
