import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  DynamicDrawUsage,
  Scene,
  WebGLRenderTarget,
  Vector2,
  Vector3,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { createEmberMaterial, createSatelliteIdMaterial, createSolarMaterial, emberLinear, setDither, setHeat, setTilePx, tileLayout, type HeatMaterial } from '../../engine/heatMaterial';
import { span } from '../../engine/marks';
import { holdMotion } from '../../engine/motion';
import { LAYER_EMBER, prewarmBloom } from '../../engine/post';
import {
  clearUserOrbit,
  createControls,
  getRenderer,
  isMobile,
  makeCamera,
  reducedMotion,
  requestRender,
  setEmberGlare,
  type TabView,
} from '../../engine/renderer';
import { el } from '../../ui/readout';
import { constellationMaterial, createConstellationMesh } from './constellation';
import { instanceBudget, maxTilesPerSatellite } from './capacity';
import { BLOCK_M, blockCount, blockMetrics, footprintRadius, hexOuterRadius, ringOf } from './hex';
import { mountScaleInset } from './inset';

const RING_SEGMENTS = 96;
const UNIT_RING = new Float32Array((RING_SEGMENTS + 1) * 3);
for (let s = 0; s <= RING_SEGMENTS; s++) {
  const angle = (s / RING_SEGMENTS) * Math.PI * 2;
  UNIT_RING[s * 3] = Math.cos(angle);
  UNIT_RING[s * 3 + 2] = Math.sin(angle);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TILE = 5;
/** Instance stride: max tiles at the slider extremes, so a settings change never runs out of indices. */
const STRIDE = maxTilesPerSatellite();
const FADE_MS = 250;
const RING_OPACITY = [0.55, 0.35, 0.2];
export interface ThermalLayout {
  aRad: number;
  aTot: number;
  tHot: number;
  /** Float satellite count, P / 120 kW. The rim eases because this is not rounded. */
  count: number;
  unitRad: number;
  unitTot: number;
}
export interface MilestoneRing {
  label: string;
  radius: number;
}

interface Slot {
  mesh: InstancedMesh;
  solar: InstancedMesh;
  mat: HeatMaterial;
  solarMat: Material;
  scale: InstancedBufferAttribute;
  solarScale: InstancedBufferAttribute;
  mix: InstancedBufferAttribute;
  solarMix: InstancedBufferAttribute;
  k: number;
  area: number;
  side: number;
  c: number;
  count: number;
  born: Float64Array;
  die: Float64Array;
  mixNow: Float32Array;
  mixTo: Float32Array;
  hot: number[];
  hotOn: Uint8Array;
  bornAttr: InstancedBufferAttribute;
}

interface Zoom {
  from: number;
  to: number;
  t0: number;
  ms: number;
}

interface Ease {
  from: number;
  to: number;
  t0: number;
}

export function createThermalScene(overlay: HTMLElement) {
  const { nearCap: NEAR_CAP, maxInstances: MAX } = instanceBudget(STRIDE, isMobile());
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 1.35);
  sun.position.set(0.4, 1, 0.7);
  scene.add(sun, new AmbientLight(0xffffff, 0.45));

  const camera = makeCamera();
  camera.near = 0.05;
  camera.far = 1e8;
  camera.position.set(30, 24, 30);
  camera.updateProjectionMatrix();
  let controls = createControls(camera, { min: 0.2, max: 1e8 });
  controls.enablePan = isMobile();
  controls.target.set(0, 0, 0);

  const hexGeo = new CylinderGeometry(1, 1, 0.08, 6);
  const hex = new Mesh(
    hexGeo,
    new MeshStandardMaterial({ color: 0x12151c, metalness: 0.35, roughness: 0.55, envMap: null, envMapIntensity: 0 }),
  );
  hex.position.y = 0.16;
  hex.renderOrder = 4;
  const edges = new LineSegments(new EdgesGeometry(hexGeo), new LineBasicMaterial({ color: 0x5ce1ff }));
  hex.add(edges);
  scene.add(hex);

  const slots = [makeSlot(MAX, STRIDE), makeSlot(MAX, STRIDE)];
  const field = createConstellationMesh();
  scene.add(slots[0].mesh, slots[0].solar, slots[1].mesh, slots[1].solar, field);
  const fieldEmber = new Vector3(0.4, 0.05, 0.02);
  let emberHeat = 0;
  let shown = 0;
  let outer = 4;
  let fade: { from: number; to: number; t0: number } | null = null;
  let zoom: Zoom | null = null;
  let userAdjusted = false;
  let wake = '';
  let clipDist = -1;
  let queuedK = -1;
  let lastRad = 0;
  let lastTot = 1;
  let liveN = 1;
  let liveFoot = satelliteFootprint(1, 1);
  let shownNear = true;
  let fieldFade: { kind: 'full' | 'window'; toDetail: boolean; t0: number } | null = null;
  let windowed = false;
  let driven = false;
  let tilesNow = 1;
  let placed = false;
  let easeReady = false;
  let countsReady = false;
  let bornSats = 0;
  let lastBorn = -10;
  let fieldDist = -1;
  let fieldN = -1;
  let easeHold = false;
  const rSatEase: Ease = { from: 1, to: 1, t0: -1e4 };
  const rRadEase: Ease = { from: 0, to: 0, t0: -1e4 };
  const cEase: Ease = { from: 1, to: 1, t0: -1e4 };
  let targetFoot = satelliteFootprint(1, 1);

  const chip = el('div', 'tile-chip', '1 tile = 5 m²');
  const fitBtn = el('button', 'fit-btn', 'Fit') as HTMLButtonElement;
  fitBtn.type = 'button';
  fitBtn.addEventListener('click', () => fit());
  const label = el('div', 'world-tag', 'Compute');
  const leader = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leader.setAttribute('class', 'leader');
  const leaderLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  leader.append(leaderLine);
  overlay.append(leader, label, chip, fitBtn);
  const inset = mountScaleInset(overlay);
  const scaleBar = el('div', 'scale-bar');
  const scaleRule = el('i');
  const scaleText = el('span');
  scaleBar.append(scaleText, scaleRule);
  overlay.append(scaleBar);
  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'ring-layer';
  css2d.domElement.style.pointerEvents = 'none';
  overlay.append(css2d.domElement);
  const ringSlots = [0, 1, 2].map(() => {
    const geometry = new LineGeometry();
    const material = new LineMaterial({
      color: 0x5ce1ff,
      linewidth: 1,
      worldUnits: false,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    geometry.setPositions(UNIT_RING);
    const line = new Line2(geometry, material);
    line.position.y = 0.04;
    line.frustumCulled = false;
    line.renderOrder = 10;
    line.visible = false;
    const tag = el('div', 'ring-tag');
    const dot = el('i');
    const text = el('span');
    tag.append(dot, text);
    const label3 = new CSS2DObject(tag);
    label3.visible = false;
    scene.add(line, label3);
    return { geometry, material, line, tag, text, label3, radius: -1, easeFrom: 0, easeTo: 0, easeT0: -1e4 };
  });
  const ringResolution = new Vector2();

  const dummy = new Object3D();
  const scratch = new Vector3();

  function onStart(): void {
    setZoom(null);
    userAdjusted = true;
    driven = false;
  }
  function fitClip(force = false): void {
    const distance = camera.position.length();
    if (!force && clipDist > 0 && Math.abs(distance - clipDist) <= clipDist * 0.01) return;
    clipDist = distance;
    camera.near = Math.max(distance / 2000, 0.01);
    camera.far = distance * 50 + outer * 4;
    camera.updateProjectionMatrix();
  }
  function bindControls(): void {
    controls.addEventListener('start', onStart);
  }
  bindControls();

  function setZoom(next: Zoom | null): void {
    const had = zoom !== null;
    zoom = next;
    if (had !== (zoom !== null)) holdMotion(zoom !== null);
  }
  function setFade(next: { from: number; to: number; t0: number } | null): void {
    const had = fade !== null;
    fade = next;
    if (had !== (fade !== null)) holdMotion(fade !== null);
  }

  function fmtSatellites(n: number): string {
    if (n >= 1e6) {
      const millions = n / 1e6;
      return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)} million`;
    }
    return Math.round(n).toLocaleString('en-US');
  }

  function pxAt(rSat: number, dist: number): number {
    const h = overlay.clientHeight || 600;
    const fov = (camera.fov * Math.PI) / 180;
    return ((2 * rSat) / Math.max(dist, 1e-3)) * (h / 2) / Math.tan(fov / 2);
  }

  function setDiscDither(mode: 'in' | 'out' | 'off', gate: number): void {
    constellationMaterial.uniforms.uDitherGate!.value = gate;
    constellationMaterial.uniforms.uDitherMode!.value = mode === 'in' ? 1 : mode === 'out' ? 0 : -1;
  }

  function holeCount(): number {
    return Math.min(NEAR_CAP, Math.max(0, Math.ceil(liveN - 1e-9)));
  }

  function chooseField(px: number): void {
    if (fieldFade) return;
    const wantFull = shownNear ? px >= 32 && liveN <= NEAR_CAP * 1.2 : px >= 40 && liveN <= NEAR_CAP;
    const wantWin = !wantFull && liveN > NEAR_CAP && (windowed ? px >= 32 : px >= 40);
    if (wantFull === shownNear && wantWin === windowed) return;
    if (reducedMotion()) {
      shownNear = wantFull;
      windowed = wantWin;
      field.visible = !wantFull;
      setDiscDither('off', 1);
      setSlotDither(slots[0]!, 'off', 1);
      constellationMaterial.uniforms.uHole!.value = wantWin ? holeCount() : -1;
      return;
    }
    fieldFade = {
      kind: wantFull || shownNear ? 'full' : 'window',
      toDetail: wantFull || wantWin,
      t0: performance.now(),
    };
    shownNear = wantFull;
    windowed = wantWin;
    field.visible = true;
    holdMotion(true);
  }

  function eased(ease: Ease, now: number): number {
    if (reducedMotion()) return ease.to;
    const t = Math.min(1, Math.max(0, (now - ease.t0) / 250));
    const u = 1 - (1 - t) ** 3;
    return ease.from + (ease.to - ease.from) * u;
  }

  function kick(ease: Ease, target: number, now: number): void {
    if (Math.abs(target - ease.to) <= Math.max(1e-4, Math.abs(ease.to) * 1e-4)) return;
    ease.from = eased(ease, now);
    ease.to = target;
    ease.t0 = now;
  }

  function easeLive(ease: Ease, now: number): boolean {
    return !reducedMotion() && now - ease.t0 < 250 && Math.abs(ease.from - ease.to) > 1e-4;
  }

  function footNow(now: number): ReturnType<typeof satelliteFootprint> {
    const rSat = eased(rSatEase, now);
    const rRad = eased(rRadEase, now);
    const c = eased(cEase, now);
    return { ...targetFoot, rSat, rRad, c, spacing: 2 * rSat * 1.06 };
  }

  function syncDisc(heat: number, foot: ReturnType<typeof satelliteFootprint> = liveFoot): void {
    const ember = emberLinear(heat);
    const boost = 0.4 + 0.9 * Math.pow(Math.max(heat, 0), 1.25);
    fieldEmber.set(ember[0] * boost, ember[1] * boost, ember[2] * boost);
    const grouped = liveN > BLOCK_M;
    const block = blockMetrics(foot.spacing, foot.rSat);
    const radius = grouped
      ? footprintRadius(Math.max(liveN, 1), foot.spacing, foot.rSat) + block.pitch
      : hexOuterRadius(Math.max(liveN, 1), foot.spacing, foot.rSat) + foot.spacing;
    field.scale.set(radius, radius, radius);
    const uniforms = constellationMaterial.uniforms;
    uniforms.uN!.value = liveN;
    uniforms.uSpacing!.value = foot.spacing;
    uniforms.uRSat!.value = foot.rSat;
    uniforms.uRRad!.value = foot.rRad;
    uniforms.uM!.value = BLOCK_M;
    uniforms.uBlockPitch!.value = block.pitch;
    uniforms.uRBlk!.value = block.rBlk;
    uniforms.uHole!.value = windowed || fieldFade?.kind === 'window' ? holeCount() : -1;
    (uniforms.uEmber!.value as Vector3).copy(fieldEmber);
    if (!fieldFade) field.visible = !shownNear;
  }

  function clearTiles(): void {
    const slot = slots[0]!;
    if (slot.mesh.count !== 0) {
      slot.mesh.count = 0;
      slot.solar.count = 0;
      slot.count = 0;
    }
  }

  /** The only writer of the layout uniforms. Every power, settings, and mode change comes through here. */
  function applyLayoutUniforms(nowMs: number, spacing: number, nSat: number): void {
    if (!easeReady) return;
    const now = nowMs / 1000;
    tileLayout.uNow.value = now;
    tileLayout.uSatSpacing.value = spacing;
    tileLayout.uPhylloC.value = targetFoot.c;
    tileLayout.uSide.value = targetFoot.side;
    tileLayout.uNSat.value = nSat;
    const tiles = targetFoot.tiles;
    const nRad = targetFoot.nRad;
    if (!countsReady) {
      tileLayout.uNTilesFrom.value = tiles;
      tileLayout.uNTilesTo.value = tiles;
      tileLayout.uNRadFrom.value = nRad;
      tileLayout.uNRadTo.value = nRad;
      tileLayout.uChangeT0.value = now - 10;
      tileLayout.uKindT0.value = now - 10;
      countsReady = true;
      return;
    }
    if (tileLayout.uNTilesTo.value !== tiles) {
      tileLayout.uNTilesFrom.value = tileLayout.uNTilesTo.value;
      tileLayout.uNTilesTo.value = tiles;
      tileLayout.uChangeT0.value = now;
    }
    if (tileLayout.uNRadTo.value !== nRad) {
      tileLayout.uNRadFrom.value = tileLayout.uNRadTo.value;
      tileLayout.uNRadTo.value = nRad;
      tileLayout.uKindT0.value = now;
    }
  }

  function shownSatellites(): number {
    if (!(shownNear || windowed || fieldFade)) return 0;
    return Math.min(NEAR_CAP, Math.max(0, Math.ceil(liveN - 1e-9)));
  }

  function tileAnimLive(nowMs: number): boolean {
    const now = nowMs / 1000;
    const tileDelay = Math.abs(tileLayout.uNTilesTo.value - tileLayout.uNTilesFrom.value) * 0.003;
    if (now < tileLayout.uChangeT0.value + tileDelay + 0.25) return true;
    if (now < tileLayout.uKindT0.value + 0.3) return true;
    return now < lastBorn + 0.7;
  }

  function revealSatellites(instant: boolean): void {
    const slot = slots[0]!;
    const drawN = Math.min(NEAR_CAP, Math.max(0, Math.ceil(liveN - 1e-9)));
    if (drawN > bornSats && slot.bornAttr) {
      const now = performance.now() / 1000;
      const stamp = instant || reducedMotion() ? Math.max(0.05, now - 10) : now;
      const array = slot.bornAttr.array as Float32Array;
      for (let sat = bornSats; sat < drawN; sat++) {
        const base = sat * STRIDE;
        for (let tile = 0; tile < STRIDE; tile++) array[base + tile] = stamp;
      }
      slot.bornAttr.clearUpdateRanges();
      slot.bornAttr.addUpdateRange(bornSats * STRIDE, (drawN - bornSats) * STRIDE);
      slot.bornAttr.needsUpdate = true;
      lastBorn = stamp;
      bornSats = drawN;
    }
    const count = drawN * STRIDE;
    slot.count = count;
    slot.mesh.count = count;
    slot.solar.count = count;
    slot.side = liveFoot.side;
  }

  function layout(next: ThermalLayout, drag = false, follow: 'fit' | 'track' | 'out' | 'auto' = 'auto'): void {
    const now = performance.now();
    const area = Math.max(next.aTot, 1);
    lastRad = next.aRad;
    lastTot = area;
    targetFoot = satelliteFootprint(next.unitRad, next.unitTot);
    liveN = Math.max(0, next.count);
    tilesNow = targetFoot.tiles;
    if (!easeReady) {
      rSatEase.from = rSatEase.to = targetFoot.rSat;
      rRadEase.from = rRadEase.to = targetFoot.rRad;
      cEase.from = cEase.to = targetFoot.c;
      rSatEase.t0 = rRadEase.t0 = cEase.t0 = now - 1000;
      easeReady = true;
    } else if (follow !== 'track') {
      kick(rSatEase, targetFoot.rSat, now);
      kick(rRadEase, targetFoot.rRad, now);
      kick(cEase, targetFoot.c, now);
    }
    liveFoot = footNow(now);
    outer = footprintRadius(Math.max(liveN, 1), liveFoot.spacing, liveFoot.rSat);
    const goal = footprintRadius(Math.max(liveN, 1), targetFoot.spacing, targetFoot.rSat);
    driven = follow === 'track' || follow === 'fit';
    const settings = follow === 'auto' && placed && !drag;
    const tracking = driven || (follow === 'auto' && !userAdjusted && !drag && !placed);
    const dist = tracking ? distanceFor(0.75, goal) : Math.max(camera.position.length(), 1e-3);
    if (!settings) {
      fieldDist = dist;
      fieldN = liveN;
      span('level switch', () => chooseField(pxAt(liveFoot.rSat, follow === 'track' ? distanceFor(0.75, goal) : dist)));
    }
    const heat = Math.min(1, Math.max(0, (next.tHot - 1) / 649));
    emberHeat = heat;
    setHeat(slots[0]!.mat, heat);
    setHeat(slots[1]!.mat, heat);
    syncDisc(heat, liveFoot);
    if (shownNear || windowed || fieldFade) revealSatellites(fieldFade !== null || bornSats === 0);
    else clearTiles();
    applyLayoutUniforms(now, liveFoot.spacing, shownSatellites());
    const shownCount = Math.max(1, Math.ceil(liveN - 1e-9));
    const text = shownCount > BLOCK_M
      ? `${blockCount(shownCount).toLocaleString('en-US')} gigawatt blocks · ${BLOCK_M.toLocaleString('en-US')} satellites each · 1 satellite = 120 kW`
      : `${fmtSatellites(shownCount)} satellites · 1 satellite = 120 kW`;
    if (chip.textContent !== text) {
      chip.textContent = text;
      chip.classList.add('flash');
      window.setTimeout(() => chip.classList.remove('flash'), 200);
    }
    span('inset update', () => inset.setArea(area));
    if (follow === 'track') {
      setZoom(null);
      applyDistance(distanceFor(0.75, goal));
    } else if (follow === 'fit' || (follow === 'auto' && !userAdjusted && !drag && !placed)) {
      applyDistance(distanceFor(0.75, goal));
      placed = true;
      requestAnimationFrame(() => {
        if (!userAdjusted && overlay.clientWidth > 2) applyDistance(distanceFor(0.75, goal));
      });
    } else if (follow === 'out' || settings) {
      considerZoom(goal);
      placed = true;
    }
    requestRender();
  }

  function prepareSlot(slot: Slot, k: number): void {
    slot.k = k;
    slot.area = 5 * 10 ** k;
    slot.side = Math.sqrt(slot.area) * 0.92;
    slot.c = Math.sqrt((1.25 * slot.area) / Math.PI);
    slot.count = 0;
    slot.die.fill(0);
    slot.hot.length = 0;
    slot.hotOn.fill(0);
  }

  function setSlotDither(slot: Slot, mode: 'in' | 'out' | 'off', gate: number): void {
    setDither(slot.mat, mode, gate);
    setDither(slot.solarMat, mode, gate);
  }

  function switchTo(k: number, instant = false): Slot {
    const front = slots[shown]!;
    const next = 1 - shown;
    const back = slots[next]!;
    prepareSlot(back, k);
    if (instant || reducedMotion() || front.count === 0) {
      front.mesh.count = 0;
      front.solar.count = 0;
      front.hot.length = 0;
      front.hotOn.fill(0);
      shown = next;
      setSlotDither(back, 'off', 1);
      setSlotDither(front, 'off', 1);
      setFade(null);
      return back;
    }
    setFade({ from: shown, to: next, t0: performance.now() });
    shown = next;
    setSlotDither(back, 'in', 0);
    setSlotDither(front, 'out', 0);
    back.mesh.renderOrder = 2;
    back.solar.renderOrder = 3;
    front.mesh.renderOrder = 1;
    front.solar.renderOrder = 1;
    return back;
  }

  function fill(slot: Slot, aRad: number, aTot: number): void {
    const now = performance.now();
    const instant = fade !== null;
    const total = Math.min(MAX, Math.max(1, Math.round(aTot / slot.area)));
    const nRad = Math.min(total, Math.max(0, Math.round(aRad / slot.area)));
    const prev = slot.count;
    let matLo = MAX;
    let matHi = -1;
    for (let i = 0; i < total; i++) {
      const target = i < nRad ? 0 : 1;
      const revived = slot.die[i]! > 0;
      if (i >= prev || revived) {
        slot.born[i] = instant ? now - 2000 : now;
        slot.die[i] = 0;
        place(slot, i);
        slot.mixNow[i] = target;
        slot.mixTo[i] = target;
        markHot(slot, i);
        if (i < matLo) matLo = i;
        if (i > matHi) matHi = i;
      } else if (slot.mixTo[i] !== target) {
        slot.mixTo[i] = target;
        markHot(slot, i);
      }
    }
    for (let i = total; i < prev; i++) {
      if (slot.die[i] === 0) {
        slot.die[i] = now;
        markHot(slot, i);
      }
    }
    if (matHi >= matLo) {
      const start = matLo * 16;
      const count = (matHi - matLo + 1) * 16;
      const emberMatrix = slot.mesh.instanceMatrix;
      const solarMatrix = slot.solar.instanceMatrix;
      emberMatrix.clearUpdateRanges();
      solarMatrix.clearUpdateRanges();
      emberMatrix.addUpdateRange(start, count);
      solarMatrix.addUpdateRange(start, count);
      emberMatrix.needsUpdate = true;
      solarMatrix.needsUpdate = true;
    }
    let drawn = total;
    for (const index of slot.hot) {
      if (slot.die[index]! > 0) drawn = Math.max(drawn, index + 1);
    }
    slot.count = total;
    slot.mesh.count = drawn;
    slot.solar.count = drawn;
    outer = slot.c * Math.sqrt(Math.max(total - 1, 0) + 0.5) + slot.side;
  }

  function markHot(slot: Slot, index: number): void {
    if (slot.hotOn[index]) return;
    slot.hotOn[index] = 1;
    slot.hot.push(index);
  }

  const matrixCache: Float32Array[] = [];
  function matricesFor(k: number): Float32Array {
    const cached = matrixCache[k];
    if (cached) return cached;
    const area = 5 * 10 ** k;
    const c = Math.sqrt((1.25 * area) / Math.PI);
    const buf = new Float32Array(MAX * 16);
    for (let i = 0; i < MAX; i++) {
      const theta = i * GOLDEN;
      const rho = c * Math.sqrt(i + 0.5);
      dummy.position.set(Math.cos(theta) * rho, 0.02, Math.sin(theta) * rho);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      buf.set(dummy.matrix.elements, i * 16);
    }
    matrixCache[k] = buf;
    return buf;
  }

  function place(slot: Slot, index: number): void {
    const src = matricesFor(slot.k);
    const emberArray = slot.mesh.instanceMatrix.array as Float32Array;
    const solarArray = slot.solar.instanceMatrix.array as Float32Array;
    const offset = index * 16;
    for (let n = 0; n < 16; n++) {
      const value = src[offset + n]!;
      emberArray[offset + n] = value;
      solarArray[offset + n] = value;
    }
  }

  function pop(slot: Slot, index: number, now: number): number {
    if (slot.die[index]! > 0) {
      if (reducedMotion()) return 0;
      const t = Math.min(1, Math.max(0, (now - slot.die[index]!) / 250));
      return slot.side * (1 - smooth(t));
    }
    if (reducedMotion()) return slot.side;
    const delay = Math.min((index % Math.max(tilesNow, 1)) * 3, 400);
    const t = Math.min(1, Math.max(0, (now - slot.born[index]! - delay) / 250));
    return slot.side * smooth(t);
  }

  function tickSlot(slot: Slot, now: number, dt: number): boolean {
    if (slot.hot.length === 0) return false;
    let live = false;
    const mixStep = Math.min(1, dt / 0.3);
    const instant = reducedMotion();
    let lo = MAX;
    let hi = -1;
    const hot = slot.hot;
    for (let n = 0; n < hot.length; ) {
      const i = hot[n]!;
      const size = pop(slot, i, now);
      slot.scale.setX(i, size);
      slot.solarScale.setX(i, size);
      const target = slot.mixTo[i] ?? 1;
      const current = slot.mixNow[i] ?? target;
      if (Math.abs(current - target) > 0.004) slot.mixNow[i] = current + (target - current) * mixStep;
      const mix = slot.mixNow[i] ?? target;
      slot.mix.setX(i, mix);
      slot.solarMix.setX(i, mix);
      if (i < lo) lo = i;
      if (i > hi) hi = i;
      const popping = slot.die[i]! > 0
        ? !instant && now - slot.die[i]! < 280
        : !instant && now < slot.born[i]! + Math.min((i % Math.max(tilesNow, 1)) * 3, 400) + 250;
      const mixing = Math.abs(mix - target) > 0.004;
      if (popping || mixing) {
        live = true;
        n += 1;
      } else {
        slot.hotOn[i] = 0;
        hot[n] = hot[hot.length - 1]!;
        hot.pop();
      }
    }
    if (hi >= lo) {
      const count = hi - lo + 1;
      for (const attr of [slot.scale, slot.solarScale, slot.mix, slot.solarMix]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(lo, count);
        attr.needsUpdate = true;
      }
    }
    let drawn = slot.count;
    for (const index of slot.hot) {
      if (slot.die[index]! > 0 && now - slot.die[index]! < 280) drawn = Math.max(drawn, index + 1);
    }
    if (drawn !== slot.mesh.count) {
      slot.mesh.count = drawn;
      slot.solar.count = drawn;
    }
    return live;
  }

  function projectedFrac(radius = outer): number {
    const w = overlay.clientWidth || 800;
    const h = overlay.clientHeight || 600;
    const dist = Math.max(camera.position.length(), 1e-3);
    const fov = (camera.fov * Math.PI) / 180;
    const px = (radius / dist) * (h / 2) / Math.tan(fov / 2);
    return px / (Math.min(w, h) / 2);
  }

  function distanceFor(frac: number, radius = outer): number {
    const w = overlay.clientWidth || 800;
    const h = overlay.clientHeight || 600;
    const fov = (camera.fov * Math.PI) / 180;
    const px = frac * (Math.min(w, h) / 2);
    return (radius * (h / 2)) / Math.tan(fov / 2) / Math.max(px, 1);
  }

  function applyDistance(dist: number): void {
    const length = Math.max(camera.position.length(), 1e-3);
    camera.position.multiplyScalar(dist / length);
    camera.lookAt(controls.target);
    controls.update();
    fitClip(true);
  }

  function considerZoom(radius = outer): void {
    if (projectedFrac(radius) <= 0.92) return;
    const dest = distanceFor(0.75, radius);
    const from = camera.position.length();
    if (from >= dest * 0.98) return;
    if (zoom) {
      zoom.to = Math.max(zoom.to, dest);
      zoom.ms = 400;
      return;
    }
    if (Math.abs(from - dest) / dest < 0.02) return;
    if (reducedMotion()) {
      applyDistance(dest);
      return;
    }
    setZoom({ from, to: dest, t0: performance.now(), ms: 400 });
  }

  function fit(): void {
    const dest = distanceFor(0.75);
    const from = camera.position.length();
    if (reducedMotion() || Math.abs(from - dest) / Math.max(dest, 1e-3) < 0.02) {
      setZoom(null);
      applyDistance(dest);
    } else {
      setZoom({ from, to: dest, t0: performance.now(), ms: 500 });
    }
    requestRender();
  }

  function view(): TabView {
    return {
      scene,
      camera,
      get controls() {
        return controls;
      },
      update(dt) {
        fitClip(false);
        setEmberGlare(emberHeat > 0.02 ? 0.35 + 1.4 * emberHeat : 0);
        const now = performance.now();
        const reasons: string[] = [];
        let live = tickSlot(slots[shown]!, now, dt);
        if (slots[0] !== slots[shown]) live = tickSlot(slots[0]!, now, dt) || live;
        if (live) reasons.push('tile-tween');
        if (easeLive(rSatEase, now) || easeLive(rRadEase, now) || easeLive(cEase, now)) {
          liveFoot = footNow(now);
          outer = footprintRadius(Math.max(liveN, 1), liveFoot.spacing, liveFoot.rSat);
          syncDisc(emberHeat, liveFoot);
          live = true;
          reasons.push('spacing');
        }
        applyLayoutUniforms(now, liveFoot.spacing, shownSatellites());
        if (tileAnimLive(now)) {
          live = true;
          reasons.push('tiles');
        }
        if (!driven && zoom === null) {
          const dist = Math.max(camera.position.length(), 1e-3);
          const moved = Math.abs(dist - fieldDist) > Math.max(0.05, Math.abs(fieldDist) * 0.002);
          const nChanged = Math.abs(liveN - fieldN) > 1e-3;
          if (moved || nChanged) {
            fieldDist = dist;
            fieldN = liveN;
            const prev = `${shownNear}:${windowed}:${fieldFade !== null}`;
            chooseField(pxAt(liveFoot.rSat, dist));
            if (prev !== `${shownNear}:${windowed}:${fieldFade !== null}`) {
              if (shownNear || windowed || fieldFade) revealSatellites(true);
              else clearTiles();
              syncDisc(emberHeat, liveFoot);
              applyLayoutUniforms(now, liveFoot.spacing, shownSatellites());
            }
          }
        }
        if (fieldFade) {
          const t = Math.min(1, (now - fieldFade.t0) / FADE_MS);
          const gate = reducedMotion() ? 1 : smooth(t);
          if (fieldFade.toDetail) {
            setSlotDither(slots[0]!, 'in', gate);
            setDiscDither('out', gate);
          } else {
            setSlotDither(slots[0]!, 'out', gate);
            setDiscDither('in', gate);
          }
          field.visible = true;
          if (t >= 1) {
            setSlotDither(slots[0]!, 'off', 1);
            setDiscDither('off', 1);
            field.visible = !shownNear;
            if (!shownNear && !windowed) clearTiles();
            constellationMaterial.uniforms.uHole!.value = windowed ? holeCount() : -1;
            fieldFade = null;
            holdMotion(false);
          }
          live = true;
          reasons.push('cross-fade');
        }
          if (fade) {
          const other = slots[fade.from]!;
          live = tickSlot(other, now, dt) || live;
          const t = Math.min(1, (now - fade.t0) / FADE_MS);
          const gate = reducedMotion() ? 1 : smooth(t);
          setSlotDither(slots[fade.to]!, 'in', gate);
          setSlotDither(other, 'out', gate);
          if (t >= 1) {
            other.mesh.count = 0;
            other.solar.count = 0;
            other.hot.length = 0;
            other.hotOn.fill(0);
            setSlotDither(other, 'off', 1);
            setSlotDither(slots[fade.to]!, 'off', 1);
            const front = slots[fade.to]!;
            setFade(null);
            if (queuedK >= 0 && queuedK !== front.k) {
              const nextK = queuedK;
              queuedK = -1;
              const slot = switchTo(nextK);
              fill(slot, lastRad, lastTot);
              const text = `1 tile = ${Math.round(slot.area).toLocaleString('en-US')} m²`;
              if (chip.textContent !== text) {
                chip.textContent = text;
                chip.classList.add('flash');
                window.setTimeout(() => chip.classList.remove('flash'), 200);
              }
            }
          }
          live = true;
          reasons.push('cross-fade');
        }
        if (zoom) {
          const t = Math.min(1, (now - zoom.t0) / zoom.ms);
          const e = 1 - (1 - t) ** 3;
          applyDistance(zoom.from + (zoom.to - zoom.from) * e);
          if (t >= 1) setZoom(null);
          live = true;
          reasons.push('auto-zoom');
        }
        publishTilePx();
        for (const ring of ringSlots) {
          if (ring.radius <= 0 || ring.easeT0 < 0) continue;
          const age = (now - ring.easeT0) / 250;
          if (age >= 0 && age < 1 && !reducedMotion()) {
            const u = 1 - (1 - age) ** 3;
            const radius = ring.easeFrom + (ring.easeTo - ring.easeFrom) * u;
            ring.label3.position.set(radius, 0.04, 0);
            ring.line.scale.set(radius, 1, radius);
            ring.radius = radius;
            live = true;
            reasons.push('rings');
          }
        }
        wake = reasons.join('+');
        const moving = reasons.includes('spacing') || reasons.includes('tiles') || reasons.includes('rings');
        if (moving !== easeHold) {
          easeHold = moving;
          holdMotion(moving);
        }
        if (updateRingScreens()) {
          live = true;
          wake = wake ? `${wake}+rings` : 'rings';
        }
        return live;
      },
      activity() {
        return wake;
      },
      resetView() {
        clearUserOrbit(controls);
        fit();
      },
      onResize() {
        if (userAdjusted || overlay.clientWidth < 2) return;
        const dest = distanceFor(0.75);
        if (camera.position.length() >= dest * 0.98) return;
        setZoom(null);
        applyDistance(dest);
      },
      syncDom() {
        if (!overlay.isConnected || overlay.clientWidth < 2) return;
        const center = project(0, 0.2, 0);
        const edge = project(1, 0.2, 0);
        const hexPx = Math.hypot(edge.x - center.x, edge.y - center.y) * 2;
        const show = center.ok && hexPx >= 8;
        label.hidden = !show;
        leaderLine.style.display = show ? '' : 'none';
        if (show) {
          label.style.left = '0';
          label.style.top = '0';
          label.style.transform = `translate3d(${center.x + 18}px, ${center.y - 22}px, 0)`;
          leaderLine.setAttribute('x1', String(center.x));
          leaderLine.setAttribute('y1', String(center.y));
          leaderLine.setAttribute('x2', String(center.x + 18));
          leaderLine.setAttribute('y2', String(center.y - 14));
        }
        updateScaleBar();
        span('label updates', () => {
          css2d.setSize(overlay.clientWidth, overlay.clientHeight);
          css2d.render(scene, camera);
        });
      },
    };
  }

  function publishTilePx(): void {
    const dist = Math.max(camera.position.length(), 1e-3);
    const closest = Math.max(dist - outer, dist * 0.2);
    const fov = (camera.fov * Math.PI) / 180;
    const px = ((overlay.clientHeight / 2) / Math.tan(fov / 2)) * getRenderer().getPixelRatio();
    for (const slot of slots) setTilePx(slot.solarMat, (slot.side / closest) * px);
  }

  function updateScaleBar(): void {
    const dist = Math.max(camera.position.length(), 1e-3);
    const fov = (camera.fov * Math.PI) / 180;
    const pxPerMeter = (overlay.clientHeight / 2) / (dist * Math.tan(fov / 2));
    if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return;
    const minM = 100 / pxPerMeter;
    const base = 10 ** Math.floor(Math.log10(Math.max(minM, 1e-9)));
    let meters = base;
    let best = Infinity;
    for (let exp = base / 10; exp <= minM * 40; exp *= 10) {
      for (const factor of [1, 2, 5]) {
        const candidate = factor * exp;
        const px = candidate * pxPerMeter;
        const outside = px < 100 || px > 200 ? 1000 : 0;
        const score = outside + Math.abs(px - 150);
        if (score < best) {
          best = score;
          meters = candidate;
        }
      }
    }
    const px = meters * pxPerMeter;
    scaleRule.style.width = `${px.toFixed(1)}px`;
    const shown = meters >= 1000 ? meters / 1000 : meters;
    const labelText = `${Number(shown.toPrecision(3))} ${meters >= 1000 ? 'km' : 'm'}`;
    if (scaleText.textContent !== labelText) scaleText.textContent = labelText;
  }

  function updateRingScreens(): boolean {
    const buffer = getRenderer().getDrawingBufferSize(ringResolution);
    let changed = false;
    const placed: { x: number; y: number }[] = [];
    for (const ring of ringSlots) {
      ring.material.resolution.set(buffer.x, buffer.y);
      if (ring.radius <= 0) continue;
      const origin = project(0, 0, 0);
      const edge = project(ring.radius, 0, 0);
      const px = Math.hypot(edge.x - origin.x, edge.y - origin.y);
      const dot = px < 6;
      // Collapsed rings share one screen point. A second label there covers the first.
      let showLabel = px >= 24 || dot;
      if (showLabel && placed.some((point) => Math.hypot(point.x - edge.x, point.y - edge.y) < 22)) showLabel = false;
      if (showLabel) placed.push({ x: edge.x, y: edge.y });
      if (ring.line.visible !== !dot) {
        ring.line.visible = !dot;
        changed = true;
      }
      ring.label3.visible = showLabel;
      ring.tag.classList.toggle('dot', dot);
    }
    return changed;
  }

  function setRings(rings: MilestoneRing[]): void {
    const now = performance.now();
    for (let i = 0; i < ringSlots.length; i++) {
      const slot = ringSlots[i]!;
      const ring = rings[i];
      if (!ring) {
        slot.line.visible = false;
        slot.label3.visible = false;
        slot.radius = -1;
        slot.easeT0 = -1e4;
        continue;
      }
      slot.text.textContent = ring.label;
      slot.material.opacity = RING_OPACITY[i] ?? 0.2;
      slot.label3.visible = true;
      slot.line.visible = true;
      const jump = slot.radius <= 0 || reducedMotion();
      if (!jump && Math.abs(ring.radius - slot.easeTo) > Math.max(1e-3, Math.abs(slot.easeTo) * 1e-4)) {
        slot.easeFrom = slot.radius;
        slot.easeTo = ring.radius;
        slot.easeT0 = now;
      } else if (jump) {
        slot.easeFrom = ring.radius;
        slot.easeTo = ring.radius;
        slot.easeT0 = now - 1000;
        slot.label3.position.set(ring.radius, 0.04, 0);
        slot.line.scale.set(ring.radius, 1, ring.radius);
        slot.radius = ring.radius;
      }
    }
    requestRender();
  }

  function project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    scratch.set(x, y, z).project(camera);
    return {
      x: (scratch.x * 0.5 + 0.5) * overlay.clientWidth,
      y: (-scratch.y * 0.5 + 0.5) * overlay.clientHeight,
      ok: scratch.z < 1,
    };
  }

  let warmed = false;
  function prewarm(): void {
    const renderer = getRenderer();
    const solarBlue = (slots[0]!.solarMat as { uniforms?: { uBlue?: { value: unknown } } }).uniforms?.uBlue?.value;
    if (solarBlue) constellationMaterial.uniforms.uBlue!.value = solarBlue;
    if (!warmed) {
      warmed = true;
      const rt = new WebGLRenderTarget(64, 64);
      const prev = renderer.getRenderTarget();
      renderer.compile(scene, camera);
      void renderer.compileAsync(scene, camera);
      const wasVisible = field.visible;
      field.visible = true;
      for (const slot of slots) {
        slot.mesh.instanceMatrix.needsUpdate = true;
        slot.solar.instanceMatrix.needsUpdate = true;
        slot.mesh.count = 1;
        slot.solar.count = 1;
        setSlotDither(slot, 'in', 0.5);
      }
      for (const ring of ringSlots) {
        ring.line.visible = true;
        ring.line.scale.set(1, 1, 1);
      }
      setDiscDither('in', 0.5);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      setDiscDither('out', 0.5);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      for (const slot of slots) {
        slot.mesh.count = 0;
        slot.solar.count = 0;
        setSlotDither(slot, 'off', 1);
      }
      for (const ring of ringSlots) {
        ring.line.visible = false;
        ring.radius = -1;
      }
      setDiscDither('off', 1);
      field.visible = wasVisible;
      rt.dispose();
      prewarmBloom(renderer, isMobile());
    }
  }

  const idMat = createSatelliteIdMaterial();
  const idTarget = new WebGLRenderTarget(512, 512, { depthBuffer: false });
  const idScene = new Scene();
  const idCam = new OrthographicCamera(-1, 1, 1, -1, 0.01, 5000);
  idCam.position.set(0, 400, 0);
  idCam.up.set(0, 0, -1);
  idCam.lookAt(0, 0, 0);
  const idColor = new Color();

  function frameIdCamera(radius: number): void {
    const span = Math.max(radius, 1);
    idCam.left = -span;
    idCam.right = span;
    idCam.top = span;
    idCam.bottom = -span;
    idCam.updateProjectionMatrix();
  }

  function readIds(into: Set<number>): void {
    const buf = new Uint8Array(512 * 512 * 4);
    getRenderer().readRenderTargetPixels(idTarget, 0, 0, 512, 512, buf);
    for (let i = 0; i < buf.length; i += 4) {
      const id = buf[i] ?? 0;
      if (id > 0) into.add(id);
    }
  }

  function countVisibleSatellites(): number {
    const renderer = getRenderer();
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(idColor);
    const prevAlpha = renderer.getClearAlpha();
    const ids = new Set<number>();
    renderer.setRenderTarget(idTarget);
    renderer.setClearColor(0x000000, 1);
    try {
      const mesh = slots[0]!.mesh;
      if (mesh.count > 0) {
        const parent = mesh.parent;
        const prevMat = mesh.material;
        mesh.material = idMat;
        const drawn = Math.max(1, Math.floor(mesh.count / STRIDE));
        const reach = ringOf(drawn - 1);
        frameIdCamera(liveFoot.spacing * (reach + 1.5) + liveFoot.rSat);
        idScene.add(mesh);
        renderer.clear();
        renderer.render(idScene, idCam);
        readIds(ids);
        mesh.material = prevMat;
        parent?.add(mesh);
      }
      if (field.visible) {
        const uniforms = constellationMaterial.uniforms;
        const prevDebug = uniforms.uDebugId!.value as number;
        const prevHole = uniforms.uHole!.value as number;
        const prevMode = uniforms.uDitherMode!.value as number;
        uniforms.uDebugId!.value = 1;
        uniforms.uHole!.value = -1;
        uniforms.uDitherMode!.value = -1;
        const parent = field.parent;
        frameIdCamera(Math.max(field.scale.x, 1) * 1.05);
        idScene.add(field);
        renderer.clear();
        renderer.render(idScene, idCam);
        readIds(ids);
        parent?.add(field);
        uniforms.uDebugId!.value = prevDebug;
        uniforms.uHole!.value = prevHole;
        uniforms.uDitherMode!.value = prevMode;
      }
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(idColor, prevAlpha);
    }
    return ids.size;
  }

  const debugWindow = window as Window & { __countSatellites?: () => number };
  debugWindow.__countSatellites = countVisibleSatellites;

  return {
    layout,
    setRings,
    prewarm,
    finishInset() {
      inset.commit();
    },
    view,
    rebind() {
      controls.dispose();
      controls = createControls(camera, { min: 0.2, max: 1e8 });
      controls.enablePan = isMobile();
      controls.target.set(0, 0, 0);
      bindControls();
      controls.update();
    },
    detach() {
      controls.dispose();
    },
  };
}

function makeSlot(count: number, stride: number): Slot {
  const geo = new BoxGeometry(1, 0.04, 1);
  const satIndex = new Float32Array(count);
  const tileIndex = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    satIndex[i] = Math.floor(i / stride);
    tileIndex[i] = i % stride;
  }
  const satAttr = new InstancedBufferAttribute(satIndex, 1);
  const tileAttr = new InstancedBufferAttribute(tileIndex, 1);
  const bornAttr = new InstancedBufferAttribute(new Float32Array(count), 1);
  bornAttr.setUsage(DynamicDrawUsage);
  geo.setAttribute('aSatIndex', satAttr);
  geo.setAttribute('aTileIndex', tileAttr);
  geo.setAttribute('aBorn', bornAttr);
  const scale = new InstancedBufferAttribute(new Float32Array(count), 1);
  const mix = new InstancedBufferAttribute(new Float32Array(count), 1);
  geo.setAttribute('aScale', scale);
  geo.setAttribute('aMix', mix);
  const solarGeo = geo.clone();
  solarGeo.setAttribute('aSatIndex', satAttr);
  solarGeo.setAttribute('aTileIndex', tileAttr);
  solarGeo.setAttribute('aBorn', bornAttr);
  const solarScale = new InstancedBufferAttribute(new Float32Array(count), 1);
  const solarMix = new InstancedBufferAttribute(new Float32Array(count), 1);
  solarGeo.setAttribute('aScale', solarScale);
  solarGeo.setAttribute('aMix', solarMix);
  const mat = createEmberMaterial({ instanced: true, heat01: 0.51 });
  const solarMat = createSolarMaterial();
  mat.envMap = null;
  mat.envMapIntensity = 0;
  const mesh = new InstancedMesh(geo, mat, count);
  const solar = new InstancedMesh(solarGeo, solarMat, count);
  mesh.layers.enable(LAYER_EMBER);
  mesh.count = 0;
  solar.count = 0;
  mesh.frustumCulled = false;
  solar.frustumCulled = false;
  const emberArray = mesh.instanceMatrix.array as Float32Array;
  const solarArray = solar.instanceMatrix.array as Float32Array;
  for (let i = 0; i < count; i++) {
    const offset = i * 16;
    emberArray[offset] = 1;
    emberArray[offset + 5] = 1;
    emberArray[offset + 10] = 1;
    emberArray[offset + 15] = 1;
    solarArray[offset] = 1;
    solarArray[offset + 5] = 1;
    solarArray[offset + 10] = 1;
    solarArray[offset + 15] = 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
  solar.instanceMatrix.needsUpdate = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  solar.instanceMatrix.setUsage(DynamicDrawUsage);
  scale.setUsage(DynamicDrawUsage);
  mix.setUsage(DynamicDrawUsage);
  solarScale.setUsage(DynamicDrawUsage);
  solarMix.setUsage(DynamicDrawUsage);
  mesh.renderOrder = 2;
  solar.renderOrder = 3;
  return {
    mesh,
    solar,
    mat,
    solarMat,
    scale,
    solarScale,
    mix,
    solarMix,
    k: -1,
    area: 5,
    side: Math.sqrt(5) * 0.92,
    c: Math.sqrt((1.25 * 5) / Math.PI),
    count: 0,
    born: new Float64Array(count),
    die: new Float64Array(count),
    mixNow: new Float32Array(count),
    mixTo: new Float32Array(count).fill(1),
    hot: [],
    hotOn: new Uint8Array(count),
    bornAttr,
  };
}

export function satelliteFootprint(aRad: number, aTot: number): {
  side: number;
  c: number;
  tiles: number;
  nRad: number;
  rSat: number;
  rRad: number;
  spacing: number;
} {
  const side = Math.sqrt(TILE) * 0.92;
  const c = Math.sqrt((1.25 * TILE) / Math.PI);
  const tiles = Math.max(1, Math.min(STRIDE, Math.round(Math.max(aTot, 1) / TILE)));
  const nRad = Math.min(tiles, Math.max(0, Math.round(Math.max(aRad, 0) / TILE)));
  const rSat = c * Math.sqrt(Math.max(tiles - 1, 0) + 0.5) + side;
  const rRad = nRad <= 0 ? 0 : c * Math.sqrt(Math.max(nRad - 1, 0) + 0.5) + side * 0.5;
  return { side, c, tiles, nRad, rSat, rRad, spacing: 2 * rSat * 1.06 };
}

export function arrayRadius(count: number, unitRad: number, unitTot: number): number {
  const foot = satelliteFootprint(unitRad, unitTot);
  return footprintRadius(Math.max(count, 1), foot.spacing, foot.rSat);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
