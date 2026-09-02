/**
 * 意味地物を「1枚の動く絵の窓」として描く MapLibre のカスタムレイヤ。
 *
 * Android 版は地物の Paint に共通の Shader を差すことでこれを実現している
 * （`OsmMap.kt` addSemanticMapFeatures / `MapPaintLayer.kt`）。Web では、
 * 地物を一度だけ三角形に分解して静的バッファへ載せ、色は
 * フラグメントシェーダが**画面座標**から計算する。結果として：
 *
 *  - 絵は1枚、地物は窓（Android と同じ意味）
 *  - 1フレームで書き換わるのは `uTime` だけ。ジオメトリには触れない
 *    （毎フレームの再構築が 2026-08-14 の ANR の原因だった、という教訓をそのまま引き継ぐ）
 */
import earcut from 'earcut';
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MlMap,
} from 'maplibre-gl';
import { FIELD_VERTEX, fieldFragment } from './field-shader';
import { ROAD, RIVER, WATER_AREA, WIDTHS, foliage, greenway, type Material } from './materials';
import { hexToRgb } from './color';

type Kind = 'sea' | 'park' | 'greenway' | 'water' | 'river' | 'road';
type Group = { material: Material; data: Float32Array; buffer: WebGLBuffer | null; count: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearRgb = (hex: string): [number, number, number] => {
  const { r, g, b } = hexToRgb(hex);
  return [toLinear(r), toLinear(g), toLinear(b)];
};

export const merc = (c: number[]) => {
  const m = MercatorCoordinate.fromLngLat({ lng: c[0], lat: c[1] });
  return [m.x, m.y] as [number, number];
};

/** 面 → 三角形。穴は使っていないので外周のみ。 */
export function polygonTriangles(rings: number[][][], out: number[]) {
  for (const ring of rings) {
    const flat: number[] = [];
    for (const c of ring) {
      const [x, y] = merc(c);
      flat.push(x, y);
    }
    for (const i of earcut(flat, undefined, 2)) out.push(flat[i * 2], flat[i * 2 + 1]);
  }
}

/**
 * 線 → 帯。太さはメルカトル単位で持つ。LP の地図はカメラを固定して使うので、
 * 固定ズームで px 幅と一致する（自由にズームさせない前提とセット）。
 *
 * 接合はマイター。区間ごとの四角を重ねて置くと、重なった画素だけアルファが二重に乗って
 * 数珠のような濃淡が出る（Android は Path をひと塗りするのでそうならない）。
 * 隣り合う四角が辺を共有するように頂点を出して、重なりそのものを作らない。
 */
export function lineTriangles(coords: number[][], halfWidth: number, out: number[]) {
  const pts: [number, number][] = [];
  for (const c of coords) {
    const p = merc(c);
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-12) pts.push(p);
  }
  if (pts.length < 2) return;

  const segmentNormals: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    segmentNormals.push([-dy / len, dx / len]);
  }

  // 各頂点のオフセット方向。内側の頂点は両隣の法線の平均（マイター）。
  const MITER_LIMIT = 3;
  const offsets: [number, number][] = pts.map((_, i) => {
    const a = segmentNormals[Math.max(i - 1, 0)];
    const b = segmentNormals[Math.min(i, segmentNormals.length - 1)];
    const mx = a[0] + b[0];
    const my = a[1] + b[1];
    const len = Math.hypot(mx, my);
    if (len < 1e-6) return [b[0] * halfWidth, b[1] * halfWidth];
    const nx = mx / len;
    const ny = my / len;
    // 鋭角ほどマイターは伸びる。伸びすぎは切る。
    const scale = Math.min(1 / Math.max(nx * b[0] + ny * b[1], 0.2), MITER_LIMIT);
    return [nx * halfWidth * scale, ny * halfWidth * scale];
  });

  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const o1 = offsets[i];
    const o2 = offsets[i + 1];
    out.push(
      x1 + o1[0], y1 + o1[1], x1 - o1[0], y1 - o1[1], x2 + o2[0], y2 + o2[1],
      x2 + o2[0], y2 + o2[1], x1 - o1[0], y1 - o1[1], x2 - o2[0], y2 - o2[1],
    );
  }
}

export class HarukiFieldLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private groups: Group[] = [];
  private programs = new Map<number, WebGLProgram>();
  private uniforms = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
  private time = 0;

  constructor(
    readonly id: string,
    private readonly geojson: GeoJSON.FeatureCollection,
    private readonly zoom: number,
    month: number,
  ) {
    // 描画順（下から）：海 → 公園 → 緑道 → 水面 → 川 → 道。
    const px = (w: number) => w / 2 / (512 * 2 ** this.zoom);
    const build = (kinds: Kind[], material: Material, halfWidth?: number): Group | null => {
      const out: number[] = [];
      for (const f of this.geojson.features) {
        const kind = (f.properties?.kind ?? '') as Kind;
        if (!kinds.includes(kind)) continue;
        if (f.geometry.type === 'Polygon') polygonTriangles(f.geometry.coordinates, out);
        else if (f.geometry.type === 'LineString' && halfWidth !== undefined)
          lineTriangles(f.geometry.coordinates, halfWidth, out);
      }
      if (!out.length) return null;
      return { material, data: new Float32Array(out), buffer: null, count: out.length / 2 };
    };

    this.groups = [
      build(['sea'], WATER_AREA),
      build(['park'], foliage(month)),
      build(['greenway'], greenway(month), px(WIDTHS.greenway)),
      build(['water'], WATER_AREA),
      build(['river'], { ...RIVER, opacity: 150 / 255 }, px(WIDTHS.riverBase)),
      build(['river'], RIVER, px(WIDTHS.riverCore)),
      build(['road'], ROAD, px(WIDTHS.majorRoad)),
    ].filter((g): g is Group => g !== null);
  }

  /** 絵を進める。Android と同じく、触るのはこの1つだけ。 */
  setTime(seconds: number) {
    this.time = seconds;
  }

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    for (const group of this.groups) {
      const octaves = group.material.octaves;
      if (!this.programs.has(octaves)) {
        const program = compile(gl, FIELD_VERTEX, fieldFragment(octaves));
        this.programs.set(octaves, program);
        this.uniforms.set(program, {
          u_matrix: gl.getUniformLocation(program, 'u_matrix'),
          uTime: gl.getUniformLocation(program, 'uTime'),
          uScale: gl.getUniformLocation(program, 'uScale'),
          uSpeed: gl.getUniformLocation(program, 'uSpeed'),
          uWarp: gl.getUniformLocation(program, 'uWarp'),
          uGain: gl.getUniformLocation(program, 'uGain'),
          uOpacity: gl.getUniformLocation(program, 'uOpacity'),
          uDpr: gl.getUniformLocation(program, 'uDpr'),
          uC0: gl.getUniformLocation(program, 'uC0'),
          uC1: gl.getUniformLocation(program, 'uC1'),
          uC2: gl.getUniformLocation(program, 'uC2'),
        });
      }
      group.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, group.data, gl.STATIC_DRAW);
    }
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    for (const g of this.groups) if (g.buffer) gl.deleteBuffer(g.buffer);
    for (const p of this.programs.values()) gl.deleteProgram(p);
    this.programs.clear();
    this.uniforms.clear();
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    // mainMatrix は Float64Array で来るので、uniform へ渡す前に 32bit へ。
    const matrix = new Float32Array(args.defaultProjectionData.mainMatrix);
    const dpr = window.devicePixelRatio || 1;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.disable(gl.DEPTH_TEST);

    for (const group of this.groups) {
      const program = this.programs.get(group.material.octaves)!;
      const u = this.uniforms.get(program)!;
      gl.useProgram(program);
      gl.uniformMatrix4fv(u.u_matrix, false, matrix);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uScale, group.material.scalePx);
      gl.uniform1f(u.uSpeed, group.material.speed);
      gl.uniform1f(u.uWarp, group.material.warp);
      gl.uniform1f(u.uGain, group.material.gain);
      gl.uniform1f(u.uOpacity, group.material.opacity);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform3fv(u.uC0, linearRgb(group.material.colors[0]));
      gl.uniform3fv(u.uC1, linearRgb(group.material.colors[1]));
      gl.uniform3fv(u.uC2, linearRgb(group.material.colors[2]));

      gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, group.count);
    }
  }
}

export function compile(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // 黙って落とさない：シェーダが壊れると地物が消えるだけで、原因が見えなくなる。
      throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, make(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, make(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
