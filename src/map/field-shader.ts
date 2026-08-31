/**
 * 地物を塗る「動く絵」のシェーダ。
 *
 * `ui/common/MapPaintLayer.kt` の AGSL を GLSL ES 3.0 へ移したもの。数式は変えていない：
 * 2段のドメインワープ fbm（q が全体を押し流し、r がその上で渦を作る。時間が3か所に入る）と、
 * π/3 ずつずらした cos² の重みによる同系色3点の混色（重みの和が常に1・n について周期1なので
 * 継ぎ目が出ない）。
 *
 * Android との対応で大事な点：
 * - AGSL の `main(float2 coord)` の coord は**デバイス空間**。ここでは `gl_FragCoord` を
 *   devicePixelRatio で割って CSS px に直す＝地物は「窓」で、絵は画面に固定される。
 * - `layout(color)` の uniform は Android 側で自動的に線形へ変換され、混色は線形空間で起きる。
 *   同じにするため、色は線形で渡して線形で混ぜ、最後に sRGB へ戻す。
 */

export const FIELD_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec2 a_pos;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

/** オクターブ数はループ回数＝定数なので、種類ごとにソースへ焼き込む（SkSL と同じ制約）。 */
export function fieldFragment(octaves: number): string {
  return `#version 300 es
precision highp float;

uniform float uTime;
uniform float uScale;
uniform float uSpeed;
uniform float uWarp;
uniform float uGain;
uniform float uOpacity;
uniform float uDpr;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;

out vec4 fragColor;

float random(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 st) {
  float v = 0.0;
  float a = 0.5;
  // 回してから重ねる。同じ向きのまま重ねると縦横の偏りが残る。
  mat2 rot = mat2(cos(0.5), sin(0.75), -sin(0.5), cos(0.5));
  for (int i = 0; i < ${octaves}; ++i) {
    v += a * noise(st);
    st = rot * st * 2.0 + vec2(100.0, 100.0);
    a *= 0.5;
  }
  return v;
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec2 coord = gl_FragCoord.xy / uDpr;
  vec2 st = coord / uScale;
  float t = uTime * uSpeed;

  vec2 q = vec2(fbm(st + vec2(10.0, 10.0)) + 0.5 * t, fbm(st + vec2(1.0, 1.0)) + 0.226 * t);
  vec2 r = vec2(
    fbm(st + uWarp * q + vec2(10.7, 90.2)) - 0.15 * t,
    fbm(st + uWarp * q + vec2(18.3, 200.8)) + 0.0226 * t
  );
  float f = fbm(st + r);

  float shade = f * f * f + 0.6 * f * f + 0.5 * f;
  float n = (shade + length(r)) * uGain;

  float w0 = cos(n * 3.14159265);
  float w1 = cos((n - 0.33333) * 3.14159265);
  float w2 = cos((n - 0.66666) * 3.14159265);
  w0 = w0 * w0 * 0.66667;
  w1 = w1 * w1 * 0.66667;
  w2 = w2 * w2 * 0.66667;

  vec3 linear = uC0 * w0 + uC1 * w1 + uC2 * w2;
  // premultiplied：MapLibre の合成に合わせる。
  fragColor = vec4(toSrgb(linear) * uOpacity, uOpacity);
}`;
}
