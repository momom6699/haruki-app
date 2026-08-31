/**
 * Haruki のカラートークンと補間。
 *
 * 値は Android 版 `app/src/main/java/com/haruki/run/ui/theme/Color.kt` の写し。
 * 派生色（季節の緑・水の3点・道の3点）は Compose の `lerp(Color, Color, Float)` で
 * 作られており、Compose は **Oklab** 空間で補間する。素直な sRGB 補間にすると
 * 同じ数式でも色が変わるので、ここでも Oklab で補間する。
 */

export type Rgb = { r: number; g: number; b: number };

export const TOKENS = {
  bg: '#F7F3E9',
  surface: '#EFE9DA',
  surfaceElevated: '#FBF8EF',
  border: '#E4DCC9',
  ink: '#2A2620',
  muted: '#6B6152',
  accentBright: '#17A5DB',
  accentDeep: '#127FB0',
  critical: '#D5583C',
  secondary: '#4B7A52',
  bookmark4: '#C8912A',
  data2: '#D7E8D1',
  routeLine: '#5E9E52',
  routeMarker: '#3C6B34',
} as const;

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklab({ r, g, b }: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Compose と同じ Oklab 補間。 */
export function lerpColor(a: string, b: string, t: number): string {
  const ca = toOklab(hexToRgb(a));
  const cb = toOklab(hexToRgb(b));
  return rgbToHex(fromOklab([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * t) as [number, number, number]));
}

/**
 * 緑の成分を落として色相を青へ寄せる（Color.kt: blueShift）。
 * シアン #17A5DB はそれ自体が青緑なので、混ぜるだけでは「緑の混じらない青」にならない。
 */
export function blueShift(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r, g: g * (1 - amount), b });
}

/** 水の基準色。Color.kt: WATER_BASE = blueShift(AccentBright, 0.30)。 */
export const WATER_BASE = blueShift(TOKENS.accentBright, 0.3);

/** 季節の緑（濃い側／淡い側）。MapPaintLayer.kt: seasonalFoliagePair。 */
export function seasonalFoliagePair(month: number): [string, string] {
  let base: string;
  if (month >= 3 && month <= 5) base = lerpColor(TOKENS.data2, TOKENS.secondary, 0.52);
  else if (month >= 6 && month <= 8) base = lerpColor(TOKENS.data2, TOKENS.secondary, 0.74);
  else if (month >= 9 && month <= 11) base = lerpColor(TOKENS.data2, TOKENS.bookmark4, 0.38);
  else base = lerpColor(TOKENS.data2, TOKENS.secondary, 0.42);
  return [lerpColor(base, TOKENS.ink, 0.26), lerpColor(base, TOKENS.data2, 0.42)];
}

/** 混色の重みが3つなので色も3つ。MapPaintLayer.kt: seasonalFoliageTriple。 */
export function seasonalFoliageTriple(month: number): [string, string, string] {
  const [deep, light] = seasonalFoliagePair(month);
  return [deep, lerpColor(deep, light, 0.5), light];
}
