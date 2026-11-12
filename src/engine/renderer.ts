import { ACESFilmicToneMapping, InstancedMesh, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { noteSlow, span } from './marks';
import { motionHeld } from './motion';
import { renderComposited } from './post';
import { presenterOn, subscribePresenter } from './presenter';

export interface TabView {
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  /** Shown in the dev perf HUD. */
  label?: string;
  update: (dt: number) => boolean;
  /** In-flight tweens, flashes, and tile pops. Camera damping is counted separately. */
  animationCount?: () => number;
  /** Why update() last returned true. Empty when the view is at rest. */
  activity?: () => string;
  /** Kessler keeps the adaptive ratio. It never snaps to a full-DPR still. */
  continuous?: boolean;
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
  geometries: number;
  programs: number;
  meshes: number;
  instances: number;
  heap: number;
  pixelRatio: number;
  scene: string;
  animations: number;
  rendered: boolean;
  looping: boolean;
  reason: string;
  renderedFrames: number;
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
let cap = 1;
let adaptive = 1;
let kesslerLow = false;
const histDt = new Float64Array(180);
const histAt = new Float64Array(180);
const sortBuf = new Float64Array(180);
let histI = 0;
let quality = 0;
let slow = 0;
let pointerDown = false;
let quietAt = 0;
let refined = false;
let calm = 0;
let costCount = 0;
let costPos = 0;
let emberGlare = 0;
let renderedFrames = 0;
let wakeReason = 'idle';
const costs = new Float64Array(10);
const passStats = { calls: 0, triangles: 0 };
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

export function getStageSize(): { width: number; height: number } {
  return { width: sizedW, height: sizedH };
}

export function setEmberGlare(value: number): void {
  emberGlare = value;
}

export function isPointerDown(): boolean {
  return pointerDown;
}

function initialRatio(): number {
  const full = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  return presenterOn() ? Math.min(full, 1.5) : full;
}

function floorRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  if (dpr < 2) return 1;
  return isMobile() ? 1.25 : 1.5;
}

function continuousRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  const next = !isMobile() && dpr >= 2 ? (kesslerLow ? 1.25 : 1.5) : floorRatio();
  return Math.min(next, cap);
}

function noteFrame(ms: number, now: number): void {
  histDt[histI] = ms;
  histAt[histI] = now;
  histI = (histI + 1) % 180;
  let n = 0;
  for (let i = 0; i < 180; i++) {
    if (histAt[i]! > 0 && now - histAt[i]! <= 2000) sortBuf[n++] = histDt[i]!;
  }
  if (n < 30) return;
  for (let i = 1; i < n; i++) {
    const v = sortBuf[i]!;
    let j = i - 1;
    while (j >= 0 && sortBuf[j]! > v) {
      sortBuf[j + 1] = sortBuf[j]!;
      j -= 1;
    }
    sortBuf[j + 1] = v;
  }
  const p95 = sortBuf[Math.min(n - 1, Math.floor(n * 0.95))]!;
  if (p95 > 20) kesslerLow = true;
  else if (p95 < 14) kesslerLow = false;
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

function noteCost(ms: number): void {
  costs[costPos] = ms;
  costPos = (costPos + 1) % 10;
  if (costCount < 10) {
    costCount += 1;
    return;
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += costs[i]!;
  const avg = sum / 10;
  const floor = floorRatio();
  if (avg > 15) {
    adaptive = Math.max(floor, Math.round((adaptive - 0.125) * 8) / 8);
    calm = 0;
    costCount = 0;
  } else if (avg < 11) {
    calm += 1;
    if (calm >= 30) {
      adaptive = Math.min(cap, Math.round((adaptive + 0.125) * 8) / 8);
      calm = 0;
      costCount = 0;
    }
  } else calm = 0;
  if (adaptive <= 1.001 && avg > 22) {
    slow += 0.16;
    if (slow > 2) {
      quality += 1;
      slow = 0;
      active?.onQualityDrop?.(quality);
    }
  } else slow = 0;
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
  const held = motionHeld();
  if (!held && active.continuous) {
    const next = continuousRatio();
    if (Math.abs(ratio - next) > 0.01) {
      ratio = next;
      applySize();
    }
  }
  const anim = active.update(dt);
  const motion = Boolean(active.continuous && anim) || moved || anim || pointerDown;
  let snap = false;
  if (held) {
    quietAt = now;
  } else if (!active.continuous && motion) {
    quietAt = now;
    refined = false;
    const next = Math.max(floorRatio(), adaptive);
    if (Math.abs(ratio - next) > 0.01) {
      ratio = next;
      applySize();
    }
  } else if (now - quietAt >= 150 && !refined && cap - ratio > 0.02) {
    ratio = cap;
    applySize();
    refined = true;
    snap = true;
  }
  const rendered = dirty || moved || anim || snap;
  const activity = anim ? active.activity?.() || 'animation' : '';
  wakeReason = rendered
    ? [
        pointerDown ? 'pointer' : '',
        dirty ? 'requested' : '',
        moved ? 'camera' : '',
        activity,
        snap ? 'pixel-ratio' : '',
      ]
        .filter(Boolean)
        .join('+') || 'render'
    : 'idle';
  if (rendered) {
    renderedFrames += 1;
    const t0 = performance.now();
    if (emberGlare > 0.02) {
      const stats = span('bloom', () => renderComposited(renderer!, active!.scene, active!.camera, { glare: emberGlare, mobile: isMobile() }));
      passStats.calls = stats.calls;
      passStats.triangles = stats.triangles;
    } else {
      span('render', () => renderer!.render(active!.scene, active!.camera));
      passStats.calls = renderer.info.render.calls;
      passStats.triangles = renderer.info.render.triangles;
    }
    const cost = performance.now() - t0;
    const bucket = (window as Window & { __costs?: number[] }).__costs;
    if (bucket) bucket.push(cost);
    noteSlow(Math.max(cost, dt * 1000));
    if (active.continuous) noteFrame(cost, now);
    else if (motion) noteCost(cost);
    dirty = false;
  }
  active.syncDom?.();
  if (perfListeners.length) {
    const info = renderer.info;
    let meshes = 0;
    let instances = 0;
    active.scene.traverse((obj) => {
      if (!(obj instanceof InstancedMesh)) return;
      meshes += 1;
      instances += obj.count;
    });
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const sample: PerfSample = {
      dtMs: dt * 1000,
      calls: passStats.calls,
      triangles: passStats.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      programs: info.programs?.length ?? 0,
      meshes,
      instances,
      heap,
      pixelRatio: ratio,
      scene: active.label ?? 'scene',
      animations: active.animationCount?.() ?? (anim ? 1 : 0),
      rendered,
      looping: rendered,
      reason: wakeReason,
      renderedFrames,
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
  const dpr = window.devicePixelRatio || 1;
  renderer = new WebGLRenderer({
    canvas,
    antialias: dpr < 2 || isMobile(),
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x05070c, 1);
  cap = initialRatio();
  adaptive = cap;
  ratio = cap;
  const fade = document.createElement('div');
  fade.id = 'stage-fade';
  container.parentElement?.append(fade);
  const arm = (down: boolean) => {
    pointerDown = down;
    if (!down) quietAt = performance.now();
    requestRender();
  };
  document.addEventListener('pointerdown', (event) => {
    const node = event.target;
    if (node instanceof Element && node.closest('.slider, #canvas-host')) arm(true);
  });
  document.addEventListener('pointerup', () => {
    if (pointerDown) arm(false);
  });
  document.addEventListener('pointercancel', () => {
    if (pointerDown) arm(false);
  });
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
    if (!host || !renderer) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    if (w === sizedW && h === sizedH && Math.abs(renderer.getPixelRatio() - ratio) < 0.01) return;
    applySize();
    requestRender();
  });
  observer.observe(container);
  subscribePresenter(() => {
    cap = initialRatio();
    adaptive = Math.min(adaptive, cap);
    if (motionHeld()) return;
    ratio = active?.continuous ? continuousRatio() : cap;
    applySize();
    requestRender();
  });
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
  quietAt = performance.now();
  refined = false;
  ratio = view.continuous ? continuousRatio() : cap;
  applySize();
  const fade = document.getElementById('stage-fade');
  if (fade) {
    fade.hidden = false;
    fade.style.opacity = '1';
  }
  const gl = renderer;
  const done = () => {
    requestRender();
    if (!fade) return;
    fade.style.opacity = '0';
    window.setTimeout(() => {
      if (fade.style.opacity === '0') fade.hidden = true;
    }, 220);
  };
  if (gl) void gl.compileAsync(view.scene, view.camera).then(done, done);
  else done();
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
