/**
 * 走ったルートを描くカスタムレイヤ。
 *
 * MapLibre の `geojson` source ＋ `line` レイヤでも同じ絵は出るが、それだと
 * **Web Worker が要る**——MapLibre は GeoJSON の解析を worker に投げるので、worker を
 * 起動できない場所（CSP で blob: を止めているサンドボックス、単体HTMLで開いたとき）では
 * 「地物は出るのにルートだけ出ない」という壊れ方をする。それに、書き出しの
 * アニメーションは毎フレーム `setData` を呼ぶので、1フレームごとに GeoJSON を
 * 積み直して worker と往復していた。
 *
 * 地物はもともと自前の WebGL レイヤで描いている（field-layer.ts）。ルートも同じ流儀にすると、
 * worker が要らなくなり、書き出しはバッファの入れ替えだけで済む。
 *
 * 太さはメルカトル単位で焼く。この地図はカメラを固定して使うので、焼いたときのズームで
 * px 幅と一致する（自由にズームさせない前提とセット。fitBounds を使う地図では、
 * **合わせたあとのズーム**を渡すこと）。
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { FIELD_VERTEX } from './field-shader';
import { compile, lineTriangles, merc } from './field-layer';
import { hexToRgb } from './color';

const FLAT_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() { fragColor = uColor; }`;

/** premultiplied で渡す。MapLibre の合成に合わせる（地物レイヤと同じ）。 */
function premultiplied(hex: string, opacity: number): [number, number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  return [r * opacity, g * opacity, b * opacity, opacity];
}

export type RouteStyle = {
  haloColor: string;
  haloWidth: number;
  haloOpacity: number;
  lineColor: string;
  lineWidth: number;
  lineOpacity: number;
  /** 始終点の印。積み重ねの地図には付けない（何百本ぶんの点は形を潰す）。 */
  marker?: { color: string; radius: number; ringColor: string; ringWidth: number };
};

type Band = { color: [number, number, number, number]; data: Float32Array; buffer: WebGLBuffer | null };

export class HarukiRouteLayer implements CustomLayerInterface {
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private bands: Band[] = [];
  private program: WebGLProgram | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uMatrix: WebGLUniformLocation | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private routes: number[][][] = [];

  constructor(
    readonly id: string,
    private readonly zoom: number,
    private readonly style: RouteStyle,
  ) {}

  /** メルカトル単位の半幅。px 幅は焼いたズームでのもの。 */
  private half(px: number) {
    return px / 2 / (512 * 2 ** this.zoom);
  }

  /** ルートを差し替える。書き出しのアニメーションはここを呼ぶだけ。 */
  setRoutes(routes: number[][][]) {
    this.routes = routes;
    this.rebuild();
  }

  private rebuild() {
    const halo: number[] = [];
    const line: number[] = [];
    for (const coords of this.routes) {
      lineTriangles(coords, this.half(this.style.haloWidth), halo);
      lineTriangles(coords, this.half(this.style.lineWidth), line);
    }

    const bands: Band[] = [
      { color: premultiplied(this.style.haloColor, this.style.haloOpacity), data: new Float32Array(halo), buffer: null },
      { color: premultiplied(this.style.lineColor, this.style.lineOpacity), data: new Float32Array(line), buffer: null },
    ];

    const marker = this.style.marker;
    if (marker && this.routes.length === 1 && this.routes[0].length > 1) {
      const ends = [this.routes[0][0], this.routes[0][this.routes[0].length - 1]];
      const ring: number[] = [];
      const core: number[] = [];
      for (const end of ends) {
        disc(end, this.half(marker.radius * 2 + marker.ringWidth * 2), ring);
        disc(end, this.half(marker.radius * 2), core);
      }
      bands.push(
        { color: premultiplied(marker.ringColor, 1), data: new Float32Array(ring), buffer: null },
        { color: premultiplied(marker.color, 1), data: new Float32Array(core), buffer: null },
      );
    }

    // 前のバッファは捨てる。書き出し中は毎フレームここを通る。
    if (this.gl) for (const band of this.bands) if (band.buffer) this.gl.deleteBuffer(band.buffer);
    this.bands = bands;
    if (this.gl) this.upload(this.gl);
  }

  private upload(gl: WebGL2RenderingContext) {
    for (const band of this.bands) {
      if (!band.data.length) continue;
      band.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, band.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, band.data, gl.DYNAMIC_DRAW);
    }
  }

  onAdd(_map: MlMap, gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = compile(gl, FIELD_VERTEX, FLAT_FRAGMENT);
    this.uColor = gl.getUniformLocation(this.program, 'uColor');
    this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
    this.upload(gl);
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    for (const band of this.bands) if (band.buffer) gl.deleteBuffer(band.buffer);
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    this.gl = null;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.program) return;
    const matrix = new Float32Array(args.defaultProjectionData.mainMatrix);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMatrix, false, matrix);
    const loc = gl.getAttribLocation(this.program, 'a_pos');
    for (const band of this.bands) {
      if (!band.buffer || !band.data.length) continue;
      gl.uniform4fv(this.uColor, band.color);
      gl.bindBuffer(gl.ARRAY_BUFFER, band.buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, band.data.length / 2);
    }
  }
}

/** 印の丸。カメラを固定して使うので、半径もメルカトル単位で焼く。 */
function disc(centre: number[], radius: number, out: number[], sides = 24) {
  const [cx, cy] = merc(centre);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 1) / sides) * Math.PI * 2;
    out.push(cx, cy, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cx + Math.cos(b) * radius, cy + Math.sin(b) * radius);
  }
}
