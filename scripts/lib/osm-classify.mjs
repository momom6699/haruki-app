/**
 * Overpass → Haruki の意味地物への振り分け。
 *
 * これは新しい分類ではなく、Android 版の
 * `app/src/main/java/com/haruki/run/ui/common/OsmMap.kt` にある
 * `isGreenAreaTag` / `isWaterAreaTag` / `MAJOR_ROAD_HIGHWAY_TAGS` /
 * `seaBandFromCoastline` / `keepDrawableAreas` の移植である。
 * Web と アプリで「公園とは何か」がずれないよう、判定は1か所にまとめてテストで固定する。
 */

/** 緑として塗る面のタグ（OsmMap.kt: isGreenAreaTag）。 */
export const GREEN_LEISURE = new Set(['park', 'garden', 'nature_reserve', 'recreation_ground']);
export const GREEN_LANDUSE = new Set(['forest', 'grass', 'meadow', 'recreation_ground', 'village_green']);
export const GREEN_NATURAL = new Set(['wood', 'scrub', 'grassland']);

/** 「走れる幅のある道」。細街路（residential/service）は含めない。 */
export const MAJOR_ROAD_HIGHWAY_TAGS = new Set(['primary', 'secondary', 'tertiary']);

/** 川として線で描く waterway。 */
export const RIVER_WATERWAY_TAGS = new Set(['river', 'stream', 'canal', 'drain']);

/** 海の帯の幅（m）。OsmMap.kt: SEA_BAND_METERS。 */
export const SEA_BAND_METERS = 1_600;
/** これより小さい面は塗らない。OsmMap.kt: MIN_AREA_SPAN_METERS。 */
export const MIN_AREA_SPAN_METERS = 30;
/** 1種類あたりの面の上限。OsmMap.kt: MAX_AREAS_PER_KIND。 */
export const MAX_AREAS_PER_KIND = 320;

const tag = (tags, key) => (tags && typeof tags[key] === 'string' ? tags[key] : '');

export function isGreenAreaTag(tags) {
  return (
    GREEN_LEISURE.has(tag(tags, 'leisure')) ||
    GREEN_LANDUSE.has(tag(tags, 'landuse')) ||
    GREEN_NATURAL.has(tag(tags, 'natural'))
  );
}

/** 池・湖・river面。川の「線」とは別に拾う。 */
export function isWaterAreaTag(tags) {
  return tag(tags, 'natural') === 'water' || tag(tags, 'waterway') === 'riverbank';
}

export function isMajorRoad(tags) {
  return MAJOR_ROAD_HIGHWAY_TAGS.has(tag(tags, 'highway'));
}

export function isRiverLine(tags) {
  return RIVER_WATERWAY_TAGS.has(tag(tags, 'waterway'));
}

/**
 * 緑道。全 footway/path は都市部で数百KBになるため、cycleway と
 * 名称で緑道と分かる道に限る（OsmMap.kt の FEATURE_QUERY_TEMPLATE と対）。
 */
export function isGreenway(tags) {
  const highway = tag(tags, 'highway');
  if (highway === 'cycleway') return true;
  if (highway !== 'footway' && highway !== 'path') return false;
  return /緑道|greenway/i.test(tag(tags, 'name'));
}

export function isCoastline(tags) {
  return tag(tags, 'natural') === 'coastline';
}

/** 面の対角の長さ（m）。小さすぎる面を落とすための粗い目安。 */
export function spanMeters(points) {
  if (!points.length) return 0;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const dLat = (Math.max(...lats) - Math.min(...lats)) * 111_000;
  const dLon = (Math.max(...lons) - Math.min(...lons)) * 111_000 * Math.cos((midLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** 小さすぎる面を落とし、大きい順に上限まで。 */
export function keepDrawableAreas(areas) {
  return areas
    .filter((a) => a.length >= 3 && spanMeters(a) >= MIN_AREA_SPAN_METERS)
    .sort((a, b) => spanMeters(b) - spanMeters(a))
    .slice(0, MAX_AREAS_PER_KIND);
}

/**
 * 海岸線から「水側の帯」を起こす（OsmMap.kt: seaBandFromCoastline）。
 * OSM は海を面として持たない。約束では海岸線の進行方向に対して右が水なので、
 * 各点を右へ bandMeters ずらした列を作り、元の線＋逆順で閉じる。
 */
export function seaBandFromCoastline(points, bandMeters = SEA_BAND_METERS) {
  if (points.length < 2) return [];
  const offset = points.map((point, index) => {
    const prev = points[Math.max(index - 1, 0)];
    const next = points[Math.min(index + 1, points.length - 1)];
    const latScale = Math.cos((point.lat * Math.PI) / 180);
    const east = (next.lon - prev.lon) * 111_000 * latScale;
    const north = (next.lat - prev.lat) * 111_000;
    const length = Math.hypot(east, north);
    if (length < 1e-6) return point;
    // 進行方向を右へ90度回した向き ＝ 水側。
    const rightEast = north / length;
    const rightNorth = -east / length;
    return {
      lat: point.lat + (rightNorth * bandMeters) / 111_000,
      lon: point.lon + (rightEast * bandMeters) / (111_000 * latScale),
    };
  });
  return [...points, ...offset.reverse()];
}

const ring = (geometry) => (geometry ?? []).map((g) => ({ lat: g.lat, lon: g.lon }));
const toCoords = (points) => points.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);

const closed = (coords) => {
  if (coords.length < 3) return coords;
  const [f] = coords;
  const l = coords[coords.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? coords : [...coords, f];
};

/**
 * Overpass の JSON を、LP が読む1つの FeatureCollection へ。
 * kind は描画側のレイヤ名と1対1に対応する。
 */
export function overpassToGeoJSON(overpass) {
  const elements = overpass?.elements ?? [];
  const parks = [];
  const waterAreas = [];
  const coastlines = [];
  const greenways = [];
  const rivers = [];
  const roads = [];

  for (const el of elements) {
    const points = ring(el.geometry);
    if (points.length < 2) continue;
    const tags = el.tags ?? {};
    if (isGreenway(tags)) greenways.push(points);
    else if (isMajorRoad(tags)) roads.push(points);
    else if (isRiverLine(tags)) rivers.push(points);
    else if (isCoastline(tags)) coastlines.push(points);
    else if (isWaterAreaTag(tags)) waterAreas.push(points);
    else if (isGreenAreaTag(tags)) parks.push(points);
  }

  const seaBands = coastlines.map((line) => seaBandFromCoastline(line)).filter((b) => b.length >= 3);

  const features = [];
  const pushArea = (rings, kind) =>
    keepDrawableAreas(rings).forEach((points) =>
      features.push({
        type: 'Feature',
        properties: { kind },
        geometry: { type: 'Polygon', coordinates: [closed(toCoords(points))] },
      }),
    );
  const pushLine = (lines, kind) =>
    lines.forEach((points) =>
      features.push({
        type: 'Feature',
        properties: { kind },
        geometry: { type: 'LineString', coordinates: toCoords(points) },
      }),
    );

  // 描画順（下から）：海 → 公園 → 緑道 → 水面 → 川 → 道。
  // Android の addSemanticMapFeatures はコメント上「海がいちばん下」と書きながら
  // 公園より後に足しているが、ここは書かれている意図のほうに従う。
  pushArea(seaBands, 'sea');
  pushArea(parks, 'park');
  pushLine(greenways, 'greenway');
  pushArea(waterAreas, 'water');
  pushLine(rivers, 'river');
  pushLine(roads, 'road');

  return { type: 'FeatureCollection', features };
}
