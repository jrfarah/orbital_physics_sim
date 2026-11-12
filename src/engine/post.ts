import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from 'three';
import { bloomOnly } from './heatMaterial';

export const LAYER_EMBER = 2;

const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new Mesh(new PlaneGeometry(2, 2));
const pass = new Scene();
pass.add(quad);

const texel = new Vector2();
const dirX = new Vector2(1, 0);
const dirY = new Vector2(0, 1);

function target(w: number, h: number, float: boolean): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    format: RGBAFormat,
    type: float ? HalfFloatType : undefined,
    depthBuffer: true,
  });
  return rt;
}

let ember: WebGLRenderTarget | null = null;
let blurA: WebGLRenderTarget | null = null;
let blurB: WebGLRenderTarget | null = null;
let cw = 0;
let ch = 0;

const blurMat = new ShaderMaterial({
  uniforms: { uMap: { value: null }, uDir: { value: new Vector2(1, 0) }, uTexel: { value: new Vector2() } },
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap;
    uniform vec2 uDir;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 o = uDir * uTexel;
      vec3 c = texture2D(uMap, vUv).rgb * 0.227027;
      c += texture2D(uMap, vUv + o).rgb * 0.1945946;
      c += texture2D(uMap, vUv - o).rgb * 0.1945946;
      c += texture2D(uMap, vUv + o * 2.0).rgb * 0.1216216;
      c += texture2D(uMap, vUv - o * 2.0).rgb * 0.1216216;
      c += texture2D(uMap, vUv + o * 3.0).rgb * 0.054054;
      c += texture2D(uMap, vUv - o * 3.0).rgb * 0.054054;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});

const addMat = new ShaderMaterial({
  uniforms: { uBloom: { value: null }, uGlare: { value: 0 } },
  depthTest: false,
  depthWrite: false,
  blending: AdditiveBlending,
  transparent: true,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uBloom;
    uniform float uGlare;
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(texture2D(uBloom, vUv).rgb * uGlare, 1.0);
    }
  `,
});

function fit(rt: WebGLRenderTarget | null, w: number, h: number, float: boolean): WebGLRenderTarget {
  if (rt && rt.width === w && rt.height === h) return rt;
  rt?.dispose();
  return target(w, h, float);
}

function blur(renderer: WebGLRenderer, source: WebGLRenderTarget, dest: WebGLRenderTarget, dir: Vector2): void {
  blurMat.uniforms.uMap.value = source.texture;
  (blurMat.uniforms.uDir.value as Vector2).copy(dir);
  (blurMat.uniforms.uTexel.value as Vector2).set(1 / source.width, 1 / source.height);
  quad.material = blurMat;
  renderer.setRenderTarget(dest);
  renderer.render(pass, ortho);
}

/** Draw the scene to the canvas, then add only the bloom texture. The main frame is never resampled. */
export function renderComposited(
  renderer: WebGLRenderer,
  scene: ThreeScene,
  camera: Camera,
  opts: { glare: number; mobile: boolean },
): { calls: number; triangles: number } {
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  let calls = renderer.info.render.calls;
  let triangles = renderer.info.render.triangles;
  if (opts.glare <= 0.02) return { calls, triangles };
  const size = renderer.getDrawingBufferSize(texel);
  const w = Math.max(1, Math.floor(size.x));
  const h = Math.max(1, Math.floor(size.y));
  if (w !== cw || h !== ch || !ember || !blurA || !blurB) {
    const div = opts.mobile ? 8 : 4;
    ember = fit(ember, Math.max(1, Math.floor(w / div)), Math.max(1, Math.floor(h / div)), true);
    blurA = fit(blurA, Math.max(1, Math.floor(w / (div * 2))), Math.max(1, Math.floor(h / (div * 2))), true);
    blurB = fit(blurB, ember.width, ember.height, true);
    cw = w;
    ch = h;
  }
  const mask = camera.layers.mask;
  camera.layers.set(LAYER_EMBER);
  bloomOnly.value = 1;
  renderer.setRenderTarget(ember);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  calls += renderer.info.render.calls;
  triangles += renderer.info.render.triangles;
  bloomOnly.value = 0;
  camera.layers.mask = mask;
  renderer.setClearColor(0x05070c, 1);
  blur(renderer, ember!, blurA!, dirX);
  blur(renderer, blurA!, blurB!, dirY);
  blur(renderer, blurB!, blurA!, dirX);
  blur(renderer, blurA!, blurB!, dirY);
  addMat.uniforms.uBloom!.value = blurB!.texture;
  addMat.uniforms.uGlare!.value = opts.glare;
  quad.material = addMat;
  const clear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.render(pass, ortho);
  renderer.autoClear = clear;
  calls += 1;
  return { calls, triangles };
}
