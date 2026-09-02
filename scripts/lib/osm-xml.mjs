/**
 * OSM XML（openstreetmap.org の Export）→ Overpass の `out geom` と同じ形。
 *
 * 判定も間引きもここではしない。形を揃えるだけ——分類は osm-classify.mjs の一か所に置く、
 * という約束を崩さないため。整形された OSM の出力だけを相手にする素朴な読み取りで、
 * 一般の XML パーサではない。
 */
export function osmXmlToOverpass(xml) {
  const nodes = new Map();
  for (const [, id, lat, lon] of xml.matchAll(/<node[^>]*\sid="(\d+)"[^>]*\slat="([-\d.]+)"[^>]*\slon="([-\d.]+)"/g)) {
    nodes.set(id, { lat: Number(lat), lon: Number(lon) });
  }
  const tagsOf = (body) =>
    Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map(([, k, v]) => [k, decode(v)]));

  const elements = [];
  for (const [, open, body] of xml.matchAll(/<node([^>]*)>([\s\S]*?)<\/node>/g)) {
    const tags = tagsOf(body);
    const lat = Number(/\slat="([-\d.]+)"/.exec(open)?.[1]);
    const lon = Number(/\slon="([-\d.]+)"/.exec(open)?.[1]);
    if (Object.keys(tags).length && Number.isFinite(lat)) elements.push({ type: 'node', lat, lon, tags });
  }
  for (const [, , body] of xml.matchAll(/<way([^>]*)>([\s\S]*?)<\/way>/g)) {
    const geometry = [...body.matchAll(/<nd ref="(\d+)"\s*\/>/g)].map(([, ref]) => nodes.get(ref)).filter(Boolean);
    if (geometry.length >= 2) elements.push({ type: 'way', tags: tagsOf(body), geometry });
  }
  return { elements };
}

/** OSM が書く実体参照だけ。汎用の XML 実体は扱わない。 */
const decode = (v) =>
  v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
