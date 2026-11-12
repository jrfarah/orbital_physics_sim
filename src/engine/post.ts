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
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene as ThreeScene,
  type WebGLRenderer,
} from 'three';
import { bloomOnly } from './heatMaterial';
import { motionHeld } from './motion';
import { presenterOn } from './presenter';

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
    type: float ? HalfFloatType : UnsignedByteType,
    depthBuffer: true,
  });
  return rt;
}

let floatOk: boolean | null = null;

function floatColor(renderer: WebGLRenderer): boolean {
  if (floatOk !== null) return floatOk;
  const gl = renderer.getContext();
  floatOk = Boolean(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
  return floatOk;
}

function allocate(renderer: WebGLRenderer, w: number, h: number): WebGLRenderTarget {
  const useFloat = floatColor(renderer);
  const rt = target(w, h, useFloat);
  if (!useFloat) return rt;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  const gl = renderer.getContext();
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  renderer.setRenderTarget(prev);
  if (complete) return rt;
  rt.dispose();
  floatOk = false;
  return target(w, h, false);
}

function glareScale(): number {
  return floatOk === false ? 0.7 : 1;
}

let ember: WebGLRenderTarget | null = null;
let blurA: WebGLRenderTarget | null = null;
let blurB: WebGLRenderTarget | null = null;
let divNow = 0;

function bloomDiv(mobile: boolean): number {
  return mobile || presenterOn() ? 8 : 4;
}

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

function fit(renderer: WebGLRenderer, rt: WebGLRenderTarget | null, w: number, h: number): WebGLRenderTarget {
  const byte = floatOk === false;
  if (rt && rt.width === w && rt.height === h && (byte || rt.texture.type === HalfFloatType)) return rt;
  rt?.dispose();
  return allocate(renderer, w, h);
}

function blur(renderer: WebGLRenderer, source: WebGLRenderTarget, dest: WebGLRenderTarget, dir: Vector2): void {
  blurMat.uniforms.uMap.value = source.texture;
  (blurMat.uniforms.uDir.value as Vector2).copy(dir);
  (blurMat.uniforms.uTexel.value as Vector2).set(1 / source.width, 1 / source.height);
  quad.material = blurMat;
  renderer.setRenderTarget(dest);
  renderer.render(pass, ortho);
}

function ensureTargets(
  renderer: WebGLRenderer,
  w: number,
  h: number,
  div: number,
  mobile: boolean,
): { viewW: number; viewH: number } {
  let bw = Math.max(1, Math.floor(w / div));
  let bh = Math.max(1, Math.floor(h / div));
  if (mobile) {
    const canvas = renderer.domElement;
    bw = Math.min(bw, Math.max(1, Math.floor((canvas.clientWidth * 1.25) / 8)));
    bh = Math.min(bh, Math.max(1, Math.floor((canvas.clientHeight * 1.25) / 8)));
  }
  const held = motionHeld();
  const grow = !ember || !blurA || !blurB || bw > ember.width || bh > ember.height || div !== divNow;
  if (!held && grow) {
    ember = fit(renderer, ember, bw, bh);
    blurA = fit(renderer, blurA, Math.max(1, Math.floor(bw / 2)), Math.max(1, Math.floor(bh / 2)));
    blurB = fit(renderer, blurB, ember.width, ember.height);
    divNow = div;
  } else if (!ember || !blurA || !blurB) {
    ember = fit(renderer, ember, bw, bh);
    blurA = fit(renderer, blurA, Math.max(1, Math.floor(bw / 2)), Math.max(1, Math.floor(bh / 2)));
    blurB = fit(renderer, blurB, ember.width, ember.height);
    divNow = div;
  }
  return {
    viewW: Math.min(bw, ember!.width),
    viewH: Math.min(bh, ember!.height),
  };
}

/** Allocate the bloom targets and run the passes once so the driver links them before an animation. */
export function prewarmBloom(renderer: WebGLRenderer, mobile: boolean): void {
  const size = renderer.getDrawingBufferSize(texel);
  ensureTargets(renderer, Math.max(1, Math.floor(size.x)), Math.max(1, Math.floor(size.y)), bloomDiv(mobile), mobile);
  const prev = renderer.getRenderTarget();
  blur(renderer, ember!, blurA!, dirX);
  blur(renderer, blurA!, blurB!, dirY);
  renderer.setRenderTarget(prev);
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
  const view = ensureTargets(renderer, w, h, bloomDiv(opts.mobile), opts.mobile);
  const mask = camera.layers.mask;
  camera.layers.set(LAYER_EMBER);
  bloomOnly.value = 1;
  renderer.setRenderTarget(ember);
  const tight = view.viewW === ember!.width && view.viewH === ember!.height;
  if (!tight) {
    renderer.setViewport(0, 0, view.viewW, view.viewH);
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, view.viewW, view.viewH);
  }
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  if (!tight) renderer.setScissorTest(false);
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
  addMat.uniforms.uGlare!.value = opts.glare * glareScale();
  quad.material = addMat;
  const clear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.render(pass, ortho);
  renderer.autoClear = clear;
  calls += 1;
  return { calls, triangles };
}
