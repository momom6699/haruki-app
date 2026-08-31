/**
 * 地図の「動く絵」の設定。
 *
 * Android 版 `ui/common/MapPaintLayer.kt` の AGSL 版と同じ考え方：
 * **1本のシェーダを共通に持ち、渡す値だけを変える**。水・水面・緑・道で
 * 別々のコードを持たない。数値は Kotlin 側の直値をそのまま写している。
 */
import { TOKENS, WATER_BASE, lerpColor, seasonalFoliageTriple } from './color';

export type Material = {
  /** fbm のオクターブ数。SkSL と同じくループ回数は定数なので、シェーダを種類ごとに焼く。 */
  octaves: number;
  /** 模様の大きさ（CSS px）。線で読ませるものは細かく、広い面は粗く。 */
  scalePx: number;
  speed: number;
  warp: number;
  gain: number;
  /** 同系色3点。cos² の重みで混ぜるので3つ要る。 */
  colors: [string, string, string];
  /** Paint のアルファ相当（OsmMap.kt の *_ALPHA を 0..1 へ）。 */
  opacity: number;
};

const white = '#FFFFFF';

/**
 * 川（線）。8px の線の中で読める細かさと強いコントラスト。
 * 面の値をそのまま線に使っていて「動いていない」と言われたのが 2026-08-22。
 */
export const RIVER: Material = {
  octaves: 3,
  scalePx: 30,
  speed: 1.0,
  warp: 1.0,
  gain: 1.45,
  colors: [lerpColor(WATER_BASE, white, 0.45), lerpColor(WATER_BASE, white, 0.7), lerpColor(WATER_BASE, white, 0.9)],
  opacity: 225 / 255, // RIVER_CORE_ALPHA
};

/** 池・湖・海（面）。川と同じ設定は使えない（広い面だと沸き立って見える）。 */
export const WATER_AREA: Material = {
  octaves: 2,
  scalePx: 110,
  speed: 0.35,
  warp: 1.0,
  gain: 0.75,
  colors: [lerpColor(WATER_BASE, white, 0.32), lerpColor(WATER_BASE, white, 0.58), lerpColor(WATER_BASE, white, 0.82)],
  opacity: 175 / 255, // WATER_AREA_ALPHA
};

/** 緑：ゆっくり。面が広いのでオクターブを落とす。 */
export function foliage(month: number): Material {
  return {
    octaves: 2,
    scalePx: 115,
    speed: 0.14,
    warp: 0.8,
    gain: 0.9,
    colors: seasonalFoliageTriple(month),
    opacity: 205 / 255, // PARK_FILL_ALPHA
  };
}

/** 道：主役ではないので、いちばん静かに。 */
export const ROAD: Material = {
  octaves: 2,
  scalePx: 170,
  speed: 0.06,
  warp: 0.6,
  gain: 0.85,
  colors: [lerpColor(TOKENS.bookmark4, TOKENS.data2, 0.34), TOKENS.bookmark4, lerpColor(TOKENS.bookmark4, TOKENS.ink, 0.14)],
  opacity: 150 / 255, // MAJOR_ROAD_ALPHA
};

/** 緑道は公園と同じ絵で塗る（細長い緑地なので、同じ色が動くのが自然）。 */
export function greenway(month: number): Material {
  return { ...foliage(month), opacity: 235 / 255 }; // GREENWAY_ALPHA
}

/**
 * 線の太さ（OsmMap.kt の *_WIDTH）。Android は px 直値なので、そのまま CSS px として扱う。
 */
export const WIDTHS = {
  riverBase: 8,
  riverCore: 4.5,
  greenway: 15,
  majorRoad: 7,
} as const;

/**
 * 絵を進める間隔（ms）。OsmMap.kt: MAP_MOTION_FRAME_MILLIS。
 * 毎フレーム回さないのは電池のため——8fps 程度でも、この速さなら動きは読める。
 */
export const MOTION_FRAME_MS = 120;
