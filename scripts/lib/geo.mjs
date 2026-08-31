/** 小さな決定論的乱数（mulberry32）。fixture は毎回同じものが出ないと差分が読めない。 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG = 111_000;

/** 中心からの東/北（m）を緯度経度へ。LP は狭い範囲しか見ないので平面近似で足りる。 */
export function offsetToLatLon(center, eastMeters, northMeters) {
  const latScale = Math.cos((center.lat * Math.PI) / 180);
  return {
    lat: center.lat + northMeters / M_PER_DEG,
    lon: center.lon + eastMeters / (M_PER_DEG * latScale),
  };
}

export function latLonToOffset(center, point) {
  const latScale = Math.cos((center.lat * Math.PI) / 180);
  return {
    east: (point.lon - center.lon) * M_PER_DEG * latScale,
    north: (point.lat - center.lat) * M_PER_DEG,
  };
}

export const toCoord = (p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))];

/** Catmull-Rom で点列をなめらかに（手で置いた少数の点から自然な曲線を作る）。 */
export function smooth(points, perSegment = 6) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ east: f(p0.east, p1.east, p2.east, p3.east), north: f(p0.north, p1.north, p2.north, p3.north) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
