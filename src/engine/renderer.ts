import { ACESFilmicToneMapping, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface TabView {
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  /** Shown in the dev perf HUD. */
  label?: string;
  update: (dt: number) => boolean;
  /** In-flight tweens, flashes, and tile pops. Camera damping is counted separately. */
  animationCount?: () => number;
  resetView: () => void;
  onQualityDrop?: (level: number) => void;
  onResize?: () => void;
  syncDom?: () => void;
}

export interface PerfSample {
  dtMs: number;
  calls: number;
  triangles: number;
  textures: number;
  pixelRatio: number;
  scene: string;
  animations: number;
  rendered: boolean;
}

const userMoved = new WeakMap<OrbitControls, boolean>();
let sizedW = 0;
let sizedH = 0;

let renderer: WebGLRenderer | null = null;
let host: HTMLElement | null = null;
let active: TabView | null = null;
let raf = 0;
let looping = false;
let dirty = true;
let last = 0;
let ratio = 1;
let quality = 0;
let avg = 0;
let slow = 0;
const steps = [2, 1.5, 1.25, 1];
const perfListeners: ((sample: PerfSample) => void)[] = [];

export function subscribePerf(fn: (sample: PerfSample) => void): () => void {
  perfListeners.push(fn);
  return () => {
    const index = perfListeners.indexOf(fn);
    if (index >= 0) perfListeners.splice(index, 1);
  };
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isMobile(): boolean {
  return window.matchMedia('(max-width: 899px), (pointer: coarse)').matches;
}

export function getCanvas(): HTMLCanvasElement {
  if (!renderer) throw new Error('renderer not mounted');
  return renderer.domElement;
}

export function getRenderer(): WebGLRenderer {
  if (!renderer) throw new Error('renderer not mounted');
  return renderer;
}

export function getQualityLevel(): number {
  return quality;
}

function initialRatio(): number {
  const cap = isMobile() ? 1.75 : 2;
  return Math.min(window.devicePixelRatio || 1, cap);
}

function applySize(): void {
  if (!renderer || !host || !active) return;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  active.camera.aspect = w / h;
  active.camera.updateProjectionMatrix();
  const changed = w !== sizedW || h !== sizedH;
  sizedW = w;
  sizedH = h;
  if (changed && !userMoved.get(active.controls)) active.onResize?.();
}

export function clearUserOrbit(controls: OrbitControls): void {
  userMoved.set(controls, false);
}

export function userHasOrbited(controls: OrbitControls): boolean {
  return userMoved.get(controls) === true;
}

function dropQuality(): void {
  let next = 1;
  for (const s of steps) {
    if (s < ratio - 0.01) {
      next = s;
      break;
    }
  }
  if (next >= ratio - 0.001) return;
  ratio = next;
  quality += 1;
  avg = 0;
  slow = 0;
  applySize();
  active?.onQualityDrop?.(quality);
  dirty = true;
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (document.hidden) {
    cancelAnimationFrame(raf);
    looping = false;
    return;
  }
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
  last = now;
  if (!renderer || !active) return;
  const moved = active.controls.update();
  const anim = active.update(dt);
  active.syncDom?.();
  const rendered = dirty || moved || anim;
  if (rendered) {
    renderer.render(active.scene, active.camera);
    dirty = false;
    if (anim) {
      avg = avg === 0 ? dt : avg * 0.9 + dt * 0.1;
      if (avg > 0.022) slow += dt;
      else slow = 0;
      if (slow > 2) dropQuality();
    }
  }
  if (perfListeners.length) {
    const info = renderer.info;
    const sample: PerfSample = {
      dtMs: dt * 1000,
      calls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      pixelRatio: ratio,
      scene: active.label ?? 'scene',
      animations: active.animationCount?.() ?? (anim ? 1 : 0),
      rendered,
    };
    for (const fn of perfListeners) fn(sample);
  }
  if (!rendered) {
    cancelAnimationFrame(raf);
    looping = false;
  }
}

export function requestRender(): void {
  dirty = true;
  if (!looping && renderer && !document.hidden) {
    looping = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

export function mountRenderer(container: HTMLElement): void {
  if (renderer) return;
  host = container;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x05070c, 1);
  ratio = initialRatio();
  const overlay = document.getElementById('gl-overlay');
  const show = () => {
    if (overlay) overlay.hidden = false;
  };
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    show();
  });
  canvas.addEventListener('webglcontextrestored', show);
  overlay?.addEventListener('click', () => location.reload());
  const observer = new ResizeObserver(() => {
    applySize();
    requestRender();
  });
  observer.observe(container);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (looping) cancelAnimationFrame(raf);
      looping = false;
    } else if (active) requestRender();
  });
}

export function setActiveView(view: TabView): void {
  active = view;
  view.controls.enabled = true;
  applySize();
  requestRender();
}

export function createControls(
  camera: PerspectiveCamera,
  limits?: { min?: number; max?: number },
): OrbitControls {
  const controls = new OrbitControls(camera, getCanvas());
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.6;
  controls.minDistance = limits?.min ?? 1.3;
  controls.maxDistance = limits?.max ?? 12;
  controls.enablePan = true;
  userMoved.set(controls, false);
  controls.addEventListener('start', () => {
    userMoved.set(controls, true);
    requestRender();
  });
  controls.addEventListener('change', requestRender);
  return controls;
}

export function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(40, 1, 0.01, 200);
  return cam;
}
