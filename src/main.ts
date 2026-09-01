import './styles/lp.css';
import type { MapSpec } from './map/haruki-map';

/**
 * MapLibre は gzip で 250KB を超える。文字と余白は待たせず先に出したいので、
 * 地図モジュールだけ動的に読み込む——初期 JS には入れない。
 */
const mapModule = () => import('./map/haruki-map');

const AREA = '/data/area.geojson';
const HERO = '/data/route-hero.geojson';

const json = (url: string) => fetch(url).then((r) => r.json());

/**
 * 地物の出どころを本文に出す。今は仮の合成データなので、そう書く
 * ——実データに差し替えると GeoJSON 側の attribution がそのまま OSM の表記に戻る。
 */
async function applyAttribution(): Promise<[number, number]> {
  const [area, hero] = await Promise.all([json(AREA), json(HERO)]);

  if (typeof area.attribution === 'string') {
    document.querySelectorAll('[data-attribution]').forEach((el) => {
      el.textContent = area.attribution;
    });
  }

  const coords = (hero.features[0]?.geometry?.coordinates ?? []) as number[][];
  if (!coords.length) return (area.center ?? [139.753, 35.6845]) as [number, number];
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  // 見出しは下段に置き、下から紙のヴェールが上がってくる。ルートは上半分に置きたいので
  // 地図の中心だけ南へ寄せる（縮尺は動かさない——線の太さを固定ズーム前提で焼いているため）。
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2 - (Math.max(...ys) - Math.min(...ys)) * 0.3,
  ];
}

/** ファーストビュー外の重いものは近づいてから作る。 */
function whenNear(element: Element, run: () => void, rootMargin = '200px 0px') {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        run();
      }
    },
    { rootMargin },
  );
  observer.observe(element);
}

/** デザインの reveal。reduced motion では CSS 側で最初から表示される。 */
function revealOnScroll() {
  document.querySelectorAll('.reveal').forEach((node) => {
    whenNear(node, () => node.classList.add('in'));
  });
}

async function main() {
  revealOnScroll();

  const heroCentre = await applyAttribution();

  const specs: Array<Omit<MapSpec, 'container'> & { id: string; eager?: boolean }> = [
    // ヒーロー：Today と同じ扱い。意味地物＋その日のルートを一度だけ描き出す。
    { id: 'hero-map', center: heroCentre, zoom: 14.1, semantic: true, routes: 'hero', drawRoute: true, eager: true },
    // 積み重ね：ルート線の重なりだけで濃さを出す。意味地物は描かない
    // （作者フィードバック「軌跡・日記の地図に色付けは不要」）。
    { id: 'history-map', center: heroCentre, zoom: 13.6, semantic: false, routes: 'cumulative', fitRoutes: true },
  ];

  for (const spec of specs) {
    const container = document.getElementById(spec.id);
    if (!container) continue;
    const build = () => {
      mapModule()
        .then(({ createHarukiMap }) => createHarukiMap({ ...spec, container }))
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
