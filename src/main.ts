import './styles/lp.css';
import type { MapSpec } from './map/haruki-map';

/**
 * MapLibre は gzip で 250KB を超える。文字と余白は待たせず先に出したいので、
 * 地図モジュールだけ動的に読み込む——初期 JS には入れない（§11）。
 */
const mapModule = () => import('./map/haruki-map');

/** 置いてある fixture の中心。実データに差し替えても、ここから読むので追従する。 */
const AREA = '/data/area.geojson';
const HERO = '/data/route-hero.geojson';
const CUMULATIVE = '/data/routes-cumulative.geojson';

const json = (url: string) => fetch(url).then((r) => r.json());

/** 平均ペース 7:02/km のときの所要時間。表示している距離と必ず一致させる。 */
const PACE_SECONDS_PER_KM = 7 * 60 + 2;
const hms = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

async function fillFigures() {
  const [hero, cumulative, area] = await Promise.all([json(HERO), json(CUMULATIVE), json(AREA)]);

  const metres = hero.features[0]?.properties?.distanceMetres ?? 0;
  const km = metres / 1000;
  document.querySelectorAll('[data-hero-distance]').forEach((el) => {
    el.textContent = km.toFixed(1);
  });
  document.querySelectorAll('[data-hero-duration]').forEach((el) => {
    el.textContent = hms(km * PACE_SECONDS_PER_KM);
  });

  const total = cumulative.features.reduce(
    (sum: number, f: GeoJSON.Feature) => sum + Number(f.properties?.distanceMetres ?? 0),
    0,
  );
  document.querySelectorAll('[data-cumulative-count]').forEach((el) => {
    el.textContent = String(cumulative.features.length);
  });
  document.querySelectorAll('[data-cumulative-distance]').forEach((el) => {
    el.textContent = Math.round(total / 1000).toLocaleString('en-US');
  });

  // 仮データのときは、それが分かる帰属を出す。実データに差し替えると OSM の表記に戻る。
  if (typeof area.attribution === 'string') {
    document.querySelectorAll('[data-attribution]').forEach((el) => {
      el.textContent = area.attribution;
    });
  }

  const heroCoords = (hero.features[0]?.geometry?.coordinates ?? []) as number[][];
  const xs = heroCoords.map((c) => c[0]);
  const ys = heroCoords.map((c) => c[1]);
  // 見出しは左下に置くので、地図の中心を少し南西へずらして、ルートが右上に来るようにする。
  const heroCentre: [number, number] = heroCoords.length
    ? [
        (Math.min(...xs) + Math.max(...xs)) / 2 - (Math.max(...xs) - Math.min(...xs)) * 0.28,
        (Math.min(...ys) + Math.max(...ys)) / 2 - (Math.max(...ys) - Math.min(...ys)) * 0.24,
      ]
    : ((area.center ?? [139.7528, 35.6852]) as [number, number]);

  return { center: (area.center ?? [139.7528, 35.6852]) as [number, number], heroCentre };
}

/** 最初のビューポートに要らない地図は、近づいてから作る（§11）。 */
function whenNear(element: HTMLElement, make: () => void) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          make();
        }
      }
    },
    { rootMargin: '300px' },
  );
  observer.observe(element);
}

async function main() {
  const { center, heroCentre } = await fillFigures();

  const specs: Array<Omit<MapSpec, 'container'> & { id: string; eager?: boolean }> = [
    // Today と同じ扱い：意味地物あり＋その日のルート。
    { id: 'map-hero', center: heroCentre, zoom: 14.1, semantic: true, routes: 'hero', drawRoute: true, eager: true },
    // 地図そのものを見せる。ルートは載せず、街の構造だけ。
    { id: 'map-cartography', center, zoom: 14.6, semantic: true, routes: 'none' },
    // 日記のページ。作者の指示どおり、日記・軌跡の地図に色付けはしない。
    { id: 'map-entry', center: heroCentre, zoom: 14.3, semantic: false, routes: 'hero', drawRoute: false, fitRoutes: true },
    // 積み重ね。ルート線の重なりだけで濃さを出す。
    { id: 'map-history', center, zoom: 13.6, semantic: false, routes: 'cumulative', fitRoutes: true },
  ];

  for (const spec of specs) {
    const container = document.getElementById(spec.id);
    if (!container) continue;
    const build = () => {
      mapModule()
        .then(({ createHarukiMap }) => createHarukiMap({ ...spec, container }))
        .then((h) => { (window as unknown as Record<string, unknown>).__dbg ??= {}; ((window as unknown as Record<string, Record<string, unknown>>).__dbg)[spec.id] = h; })
        .catch((error) => {
          // 黙って落とさない。地図が出ない理由が分からないのがいちばん困る。
          console.error(`[haruki-map] ${spec.id} failed`, error);
        });
    };
    if (spec.eager) build();
    else whenNear(container, build);
  }
}

main().catch((error) => console.error('[haruki] init failed', error));
