/**
 * LP の地図。デザイン（`Haruki LP standalone.html`）の実装をそのまま持ってくる。
 *
 * デザインは **Leaflet のラスタタイル**で下地を敷き、CSS のフィルタで紙の色に寄せている
 * （`.leaflet-tile-pane{filter:grayscale(1) …sepia(.22)}`）。街の細かさ——通りの一本一本、
 * 街区、水面——はこの下地が出しているもので、ルート線はその上に細く1本乗るだけ。ここを
 * 自前のベクタ描画に置き換えると、同じ配置・同じ文字でも**別物の絵**になる。だから
 * 下地はデザインどおりタイルを引く。
 *
 * デザインから変えたのは2つ。
 *
 * 1. **タイルの提供元**。デザインは `tile.openstreetmap.org` を直に引いていたが、OSM の
 *    タイル運用ポリシーは公開サイトでの常用を認めていない。アプリ（`OsmMap.kt`）と同じ
 *    **CARTO Positron `light_nolabels`** に揃える——建物・POI・地名をタイル段階で淡くする
 *    下地で、CSS フィルタ後の見え方もアプリと揃う。帰属は OSM と CARTO の両方を出す。
 *    CARTO はキー無しでもタイルを返すが透かしが焼き込まれるので、ビルド時に
 *    `VITE_CARTO_KEY` を渡す（未設定でも動く。透かし付きで出るだけ）。`.env.example` 参照。
 *    なお CARTO はラスター提供の retiring を予告済みで、これはアプリと歩調を合わせた当面の
 *    選択。乗り換え先はアプリ側の判断と合わせて別途決める。
 * 2. **ルートの出どころ**。デザインは三角関数で作った楕円のループ（道の上を通らない）だが、
 *    こちらは内堀通りの歩道からとった実際の皇居一周を使う（`scripts/lib/kokyo.mjs`）。
 *    下地が実際の地図なので、作りものの線だと道から外れているのがそのまま見えてしまう。
 */
import 'leaflet/dist/leaflet.css';
import L, { type LatLngExpression, type Map as LeafletMap, type PolylineOptions, type TileLayer } from 'leaflet';

/** CARTO の無料キー。アカウント不要・fair use。ソースへ直書きせず、ビルド時に環境変数で渡す
 *  （アプリが `local.properties` の `CARTO_API_KEY` から読むのと同じ扱い）。未設定なら
 *  キー無し＝透かし付きのタイルが出る（ビルドも動作も従来どおり）。 */
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY ?? '').trim();
const TILES = `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ''}`;
const TILE_SUBDOMAINS = 'abcd';
const ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

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

/**
 * 下地が1枚も来なかったことを画面に出す。
 *
 * タイルはこのページの外——CARTO——から来るので、そこへ出られない場所では
 * **紙とルート線だけ**が残る。地図が出ていないのか、そういう絵なのかが見分けられず、
 * 実際それで一度こじれた。届かなかったのなら、そう書く。
 */
function watchTiles(tiles: TileLayer, element: HTMLElement) {
  const LIMIT_MS = 6_000;
  let reachable = false;
  // `tileload` はタイルレイヤのイベント。Map には上がってこない
  // ——Map に付けると一枚も来ていないことになり、届いていても警告が出る。
  tiles.on('tileload', () => {
    reachable = true;
  });
  setTimeout(() => {
    if (reachable || element.querySelector('[data-map-failed]')) return;
    const note = document.createElement('p');
    note.dataset.mapFailed = '';
    note.className = 'map__failure';
    note.textContent = document.documentElement.lang.startsWith('en')
      ? 'The basemap could not be loaded.'
      : '地図の下地を読み込めませんでした。';
    element.appendChild(note);
  }, LIMIT_MS);
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
  const tiles = L.tileLayer(TILES, {
    attribution: ATTRIBUTION,
    subdomains: TILE_SUBDOMAINS,
    maxZoom: 17,
    detectRetina: false,
  });
  watchTiles(tiles, element);
  tiles.addTo(map);
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
