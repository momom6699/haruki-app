#!/usr/bin/env node
/**
 * OpenStreetMap の生データ → LP が読む GeoJSON。
 *
 *   node scripts/build-map-fixture.mjs <overpass.json|export.osm> [out.geojson]
 *   node scripts/build-map-fixture.mjs --url [lat] [lon] [radius]   # 取ってくる場所のURL
 *   node scripts/build-map-fixture.mjs --query [lat] [lon]          # クエリ本文だけ
 *
 * 問い合わせ内容は Android 版 OsmMap.kt の FEATURE_QUERY_TEMPLATE と同じものを使う
 * ——アプリと LP で「公園とは何か」がずれないように。
 *
 * 入力は Overpass の JSON でも、openstreetmap.org の Export が返す OSM XML でもよい。
 * どちらで来るか選べない場面があるので、両方読めるようにしてある。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { overpassToGeoJSON } from './lib/osm-classify.mjs';
import { osmXmlToOverpass } from './lib/osm-xml.mjs';

const RADIUS_METERS = 1_300; // OsmMap.kt: FEATURE_QUERY_RADIUS_METERS

export function overpassQuery(lat, lon, radius = RADIUS_METERS) {
  const at = `around:${radius},${lat},${lon}`;
  const green = 'leisure~"^(park|garden|nature_reserve|recreation_ground)$"';
  const greenLanduse = 'landuse~"^(forest|grass|meadow|recreation_ground|village_green)$"';
  const greenNatural = 'natural~"^(wood|scrub|grassland)$"';
  return (
    '[out:json][timeout:25];(' +
    `way(${at})[highway=cycleway];` +
    `way(${at})[highway~"footway|path"][name~"緑道|greenway",i];` +
    `way(${at})[${green}];` +
    `way(${at})[${greenLanduse}];` +
    `way(${at})[${greenNatural}];` +
    `relation(${at})[${green}];` +
    `relation(${at})[${greenLanduse}];` +
    `relation(${at})[${greenNatural}];` +
    `way(${at})[natural=water];` +
    `way(${at})[natural=coastline];` +
    `way(${at})[waterway=riverbank];` +
    `relation(${at})[natural=water];` +
    `way(${at})[highway~"^(primary|secondary|tertiary)$"];` +
    `way(${at})[waterway~"river|stream|canal|drain"];` +
    ');out center geom;'
  );
}

const args = process.argv.slice(2);
if (args[0] === '--query' || args[0] === '--url') {
  const lat = Number(args[1] ?? 35.6852);
  const lon = Number(args[2] ?? 139.7528);
  const radius = Number(args[3] ?? RADIUS_METERS);
  const query = overpassQuery(lat, lon, radius);
  if (args[0] === '--query') {
    console.log(query);
  } else {
    console.log('# ブラウザで開くと JSON が返る。保存して、このスクリプトに渡す。');
    console.log(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    console.log('\n# 地図で確かめながら実行したいとき（Run のあと Export → raw data）。');
    console.log(`https://overpass-turbo.eu/?Q=${encodeURIComponent(query)}&R`);
  }
  process.exit(0);
}
if (!args[0]) {
  console.error('usage: build-map-fixture.mjs <overpass.json|export.osm> [out.geojson]   (or --url / --query [lat] [lon] [radius])');
  process.exit(1);
}
const out = args[1] ?? 'public/data/area.geojson';
const raw = readFileSync(args[0], 'utf8');
const source = raw.trimStart().startsWith('<') ? osmXmlToOverpass(raw) : JSON.parse(raw);
const geojson = overpassToGeoJSON(source);
geojson.attribution = '© OpenStreetMap contributors';
geojson.attributionEn = '© OpenStreetMap contributors';
writeFileSync(out, JSON.stringify(geojson));
const counts = geojson.features.reduce((acc, f) => {
  acc[f.properties.kind] = (acc[f.properties.kind] ?? 0) + 1;
  return acc;
}, {});
console.log(`wrote ${out}:`, counts);
