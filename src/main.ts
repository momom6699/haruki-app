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
 * 地物の出どころを本文に出す。今は皇居周辺を手で起こした概形なので、そう書く
 * ——実データに差し替えると GeoJSON 側の attribution がそのまま OSM の表記に戻る。
 */
type HeroView = { center: [number, number]; zoom: number };
type HeroSetup = HeroView & { area: GeoJSON.FeatureCollection; hero: GeoJSON.FeatureCollection };

async function applyAttribution(container: HTMLElement | null): Promise<HeroSetup> {
  const [area, hero] = await Promise.all([json(AREA), json(HERO)]);

  // 出どころは日本語と英語で別に持つ。英語ページに日本語の但し書きだけ出ると、
  // 「実データではない」という肝心のことが読み手に伝わらない。
  const english = document.documentElement.lang.startsWith('en');
  const note = (english ? area.attributionEn : area.attribution) ?? area.attribution;
  if (typeof note === 'string') {
    document.querySelectorAll('[data-attribution]').forEach((el) => {
      el.textContent = note;
    });
  }

  const fallback: HeroSetup = { center: (area.center ?? [139.753, 35.6852]) as [number, number], zoom: 14.1, area, hero };
  const coords = (hero.features[0]?.geometry?.coordinates ?? []) as number[][];
  if (!coords.length) return fallback;
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const [west, east] = [Math.min(...xs), Math.max(...xs)];
  const [south, north] = [Math.min(...ys), Math.max(...ys)];
  const midLat = (south + north) / 2;

  return {
    // 見出しは下段に置き、下から紙のヴェールが上がってくる。ルートは上半分に置きたいので
    // 地図の中心だけ南へ寄せる。
    center: [(west + east) / 2, midLat - (north - south) * 0.3],
    zoom: heroZoom(container, [west, south, east, north], midLat),
    area,
    hero,
  };
}

/**
 * ルートが枠に収まる縮尺を器の大きさから決める。
 *
 * 固定値にすると、狭い画面でルートが枠から溢れる——皇居一周は横1.4km・縦1.8kmあり、
 * 390pxの画面では実際に切れていた。縦は上6割だけを使う（下は見出しとヴェールの場所）。
 * 上下限で挟むのは、線の太さをこの `zoom` 前提でメルカトル単位に焼いているため
 * ——大きく動かすと道や川の太さの釣り合いが崩れる。
 */
function heroZoom(
  container: HTMLElement | null,
  [west, south, east, north]: [number, number, number, number],
  latitude: number,
): number {
  const width = container?.clientWidth ?? 0;
  const height = container?.clientHeight ?? 0;
  if (!width || !height) return 14.1;
  const cos = Math.cos((latitude * Math.PI) / 180);
  const spanX = (east - west) * 111_320 * cos;
  const spanY = (north - south) * 110_540;
  const metresPerPixel = Math.max(spanX / (width * 0.84), spanY / (height * 0.6));
  const zoom = Math.log2((78_271.5 * cos) / metresPerPixel);
  return Math.min(Math.max(zoom, 13.5), 14.6);
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

/**
 * 地図を描けなかったことを画面にも出す。
 *
 * 黙って落ちると、地図の枠には帰属表示の一行だけが残る——「地図が出ない」のか
 * 「地図データの但し書きだけの絵なのか」が見た目で区別できず、報告する側も受ける側も困る。
 * 原因（WebGL が使えない、モジュールが読めない）はコンソールに出したうえで、
 * 描けなかったこと自体はここで言う。
 */
function showMapFailure(container: HTMLElement) {
  if (container.querySelector('[data-map-failed]')) return;
  const note = document.createElement('p');
  note.dataset.mapFailed = '';
  note.className = 'map__failure';
  note.textContent = document.documentElement.lang.startsWith('en')
    ? 'The map could not be drawn in this browser.'
    : 'この環境では地図を描けませんでした。';
  container.appendChild(note);
}

async function main() {
  revealOnScroll();

  const { area, hero: heroRoute, ...view } = await applyAttribution(document.getElementById('hero-map'));

  const specs: Array<Omit<MapSpec, 'container'> & { id: string; eager?: boolean }> = [
    // ヒーロー：Today と同じ扱い。意味地物＋その日のルートを一度だけ描き出す。
    { id: 'hero-map', ...view, semantic: true, routes: 'hero', drawRoute: true, eager: true },
    // 積み重ね：ルート線の重なりだけで濃さを出す。意味地物は描かない
    // （作者フィードバック「軌跡・日記の地図に色付けは不要」）。
    { id: 'history-map', center: view.center, zoom: 13.6, semantic: false, routes: 'cumulative', fitRoutes: true },
  ];

  for (const spec of specs) {
    const container = document.getElementById(spec.id);
    if (!container) continue;
    const build = () => {
      mapModule()
        .then(({ createHarukiMap, primeData, DATA_URLS }) => {
          // 画角と帰属のためにもう読んである2本を渡す。二度取りしない。
          primeData(DATA_URLS.area, area);
          primeData(DATA_URLS.hero, heroRoute);
          return createHarukiMap({ ...spec, container });
        })
        .catch((error) => {
          // 黙って落とさない。地図が出ない理由が分からないのがいちばん困る。
          console.error(`[haruki-map] ${spec.id} failed`, error);
          showMapFailure(container);
        });
    };
    if (spec.eager) build();
    else whenNear(container, build);
  }
}

main().catch((error) => console.error('[haruki] init failed', error));
