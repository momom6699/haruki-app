import './styles/lp.css';

/**
 * 地図モジュールは Leaflet を含んで重い。文字と余白は待たせず先に出したいので、
 * 動的に読み込む——初期 JS には入れない。
 */
const mapModule = () => import('./map/lp-map');

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
 * 黙って落ちると、地図の枠には何も残らない——「地図が出ない」のか「そういう絵なのか」が
 * 見た目で区別できず、報告する側も受ける側も困る。原因はコンソールに出したうえで、
 * 描けなかったこと自体はここで言う。
 */
function showMapFailure(container: HTMLElement) {
  if (container.querySelector('[data-map-failed]')) return;
  const note = document.createElement('p');
  note.dataset.mapFailed = '';
  note.className = 'map__failure';
  note.textContent = document.documentElement.lang.startsWith('en')
    ? 'The map could not be loaded.'
    : '地図を読み込めませんでした。';
  container.appendChild(note);
}

function main() {
  revealOnScroll();

  const build = (id: string, run: (m: typeof import('./map/lp-map'), el: HTMLElement) => Promise<void>) => {
    const container = document.getElementById(id);
    if (!container) return;
    const go = () =>
      mapModule()
        .then((module) => run(module, container))
        .catch((error) => {
          // 黙って落とさない。地図が出ない理由が分からないのがいちばん困る。
          console.error(`[haruki-map] ${id} failed`, error);
          showMapFailure(container);
        });
    // ヒーローはファーストビューなので待たない。積み重ねは近づいてから。
    if (id === 'hero-map') go();
    else whenNear(container, go);
  };

  build('hero-map', (module, element) => module.buildHero(element));
  build('history-map', (module, element) => module.buildHistory(element));
}

main();
