/**
 * LP の地図。デザイン（`Haruki LP standalone.html`）の実装をそのまま持ってくる。
 *
 * デザインは **Leaflet ＋ OpenStreetMap のラスタタイル**で下地を敷き、CSS のフィルタで
 * 紙の色に寄せている（`.leaflet-tile-pane{filter:grayscale(1) …sepia(.22)}`）。
 * 街の細かさ——通りの一本一本、街区、水面——はこの下地が出しているもので、
 * ルート線はその上に細く1本乗るだけ。ここを自前のベクタ描画に置き換えると、
 * 同じ配置・同じ文字でも**別物の絵**になる。だから下地はデザインどおりタイルを引く。
 *
 * デザインから変えたのは1つだけ、ルートの出どころ。デザインは三角関数で作った
 * 楕円のループ（道の上を通らない）だが、こちらは内堀通りの歩道からとった実際の
 * 皇居一周を使う（`scripts/lib/kokyo.mjs`）。下地が実際の地図なので、
 * 作りものの線だと道から外れているのがそのまま見えてしまう。
 */
import 'leaflet/dist/leaflet.css';
import L, { type LatLngExpression, type Map as LeafletMap, type PolylineOptions } from 'leaflet';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';

const HERO_URL = '/data/route-hero.geojson';
const CUMULATIVE_URL = '/data/routes-cumulative.geojson';

const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** GeoJSON は [経度, 緯度]、Leaflet は [緯度, 経度]。取り違えると地図の外へ飛ぶ。 */
const toLatLngs = (coordinates: number[][]): LatLngExpression[] =>
  coordinates.map(([lon, lat]) => [lat, lon] as LatLngExpression);

async function routes(url: string): Promise<LatLngExpression[][]> {
  const data: GeoJSON.FeatureCollection = await fetch(url).then((r) => r.json());
  return data.features
    .filter((f) => f.geometry.type === 'LineString')
    .map((f) => toLatLngs((f.geometry as GeoJSON.LineString).coordinates));
}

function base(element: HTMLElement, interactive: boolean): LeafletMap {
  const map = L.map(element, {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: false,
    dragging: interactive,
    doubleClickZoom: interactive,
    touchZoom: interactive,
    keyboard: false,
    preferCanvas: true,
  });
  L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 17, detectRetina: false }).addTo(map);
  return map;
}

/**
 * ルートを start → finish へ一度だけ描く。ループしない。
 * reduced motion のときは最初から全部描く——情報は欠けない。
 */
function drawRoute(map: LeafletMap, points: LatLngExpression[], style: PolylineOptions, done: () => void) {
  if (prefersReducedMotion()) {
    L.polyline(points, style).addTo(map);
    done();
    return;
  }
  const line = L.polyline([points[0]], style).addTo(map);
  const DURATION = 1600;
  let start: number | null = null;
  const step = (now: number) => {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / DURATION);
    const eased = 1 - (1 - t) ** 3;
    line.setLatLngs(points.slice(0, Math.max(2, Math.round(eased * points.length))));
    if (t < 1) requestAnimationFrame(step);
    else done();
  };
  requestAnimationFrame(step);
}

/** 始終点の印。積み重ねの地図には付けない（何百本ぶんの点は形を潰す）。 */
function endpoints(map: LeafletMap, points: LatLngExpression[]) {
  const marker = token('--color-route-marker', '#3C6B34');
  const paper = token('--color-bg', '#F7F3E9');
  [points[0], points[Math.round(points.length / 2)]].forEach((point, index) => {
    L.circleMarker(point, {
      radius: index === 0 ? 5 : 4,
      color: marker,
      weight: 2,
      fillColor: paper,
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
  });
}

export async function buildHero(element: HTMLElement) {
  const [route] = await routes(HERO_URL);
  if (!route?.length) throw new Error('hero route fixture is empty');
  const map = base(element, false);
  map.invalidateSize(false);
  map.fitBounds(L.latLngBounds(route).pad(0.34), { animate: false });
  drawRoute(
    map,
    route,
    {
      color: token('--color-route-line', '#5E9E52'),
      weight: 3.5,
      opacity: 1,
      lineJoin: 'round',
      lineCap: 'round',
      interactive: false,
    },
    () => endpoints(map, route),
  );
}

export async function buildHistory(element: HTMLElement) {
  const all = await routes(CUMULATIVE_URL);
  if (!all.length) throw new Error('cumulative route fixture is empty');
  const map = base(element, true);
  map.invalidateSize(false);
  map.fitBounds(L.latLngBounds(all.flat()).pad(0.12), { animate: false });
  // 何度も通った道は線が重なって濃くなる——色分けをしないで密度を出す（ヒートマップにしない）。
  const line = token('--color-route-line', '#5E9E52');
  for (const route of all) {
    L.polyline(route, { color: line, weight: 2, opacity: 0.16, lineJoin: 'round', interactive: false }).addTo(map);
  }
}
