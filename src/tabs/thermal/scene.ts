import {
  AmbientLight,
  BoxGeometry,
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
  DynamicDrawUsage,
  Scene,
  Vector3,
} from 'three';
import { createEmberMaterial, createSolarMaterial, setHeat, setTilePx, type HeatMaterial } from '../../engine/heatMaterial';
import { LAYER_EMBER } from '../../engine/post';
import {
  clearUserOrbit,
  createControls,
  getRenderer,
  makeCamera,
  reducedMotion,
  requestRender,
  setEmberGlare,
  type TabView,
} from '../../engine/renderer';
import { el } from '../../ui/readout';
import { mountScaleInset } from './inset';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const MAX = 2600;
export interface ThermalLayout {
  aRad: number;
  aTot: number;
  tHot: number;
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
}

interface Zoom {
  from: number;
  to: number;
  t0: number;
}

export function createThermalScene(overlay: HTMLElement) {
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
  controls.enablePan = false;
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

  const slots = [makeSlot(), makeSlot()];
  scene.add(slots[0].mesh, slots[0].solar, slots[1].mesh, slots[1].solar);
  let emberHeat = 0;
  let shown = 0;
  let outer = 4;
  let fade: { from: number; to: number; t0: number } | null = null;
  let zoom: Zoom | null = null;
  let userAdjusted = false;
  let wake = '';
  let clipDist = -1;
  let heldK = -1;
  let heldAt = 0;
  let queuedK = -1;
  let lastRad = 0;
  let lastTot = 1;

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

  const dummy = new Object3D();
  const scratch = new Vector3();

  function onStart(): void {
    zoom = null;
    userAdjusted = true;
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

  function layout(next: ThermalLayout, zoomOut = false, drag = false): void {
    const area = Math.max(next.aTot, 1);
    lastRad = next.aRad;
    lastTot = area;
    const k = pickK(area, slots[shown]!.k);
    const slot = ensureLevel(k, drag);
    const heat = Math.min(1, Math.max(0, (next.tHot - 1) / 649));
    emberHeat = heat;
    setHeat(slots[0]!.mat, heat);
    setHeat(slots[1]!.mat, heat);
    fill(slot, next.aRad, area);
    const text = `1 tile = ${Math.round(slot.area).toLocaleString('en-US')} m²`;
    if (chip.textContent !== text) chip.textContent = text;
    inset.setArea(area);
    if (!userAdjusted) {
      applyDistance(distanceFor(0.75));
      requestAnimationFrame(() => {
        if (!userAdjusted && overlay.clientWidth > 2) applyDistance(distanceFor(0.75));
      });
    } else if (zoomOut) {
      considerZoom();
    }
    requestRender();
  }

  function ensureLevel(k: number, drag: boolean): Slot {
    const front = slots[shown]!;
    if (front.k === k) {
      queuedK = -1;
      heldK = -1;
      return front;
    }
    if (drag) {
      if (heldK !== k) {
        heldK = k;
        heldAt = performance.now();
        return front;
      }
      if (performance.now() - heldAt < 150) return front;
    } else {
      heldK = -1;
    }
    if (fade) {
      queuedK = k;
      return front;
    }
    queuedK = -1;
    heldK = -1;
    return switchTo(k);
  }

  function switchTo(k: number): Slot {
    const front = slots[shown]!;
    const next = 1 - shown;
    const back = slots[next]!;
    back.k = k;
    back.area = 5 * 10 ** k;
    back.side = Math.sqrt(back.area) * 0.92;
    back.c = Math.sqrt((1.25 * back.area) / Math.PI);
    back.count = 0;
    back.die.fill(0);
    back.hot.length = 0;
    back.hotOn.fill(0);
    if (reducedMotion() || front.count === 0) {
      front.mesh.count = 0;
      front.solar.count = 0;
      front.hot.length = 0;
      front.hotOn.fill(0);
      shown = next;
      back.mat.opacity = 1;
      back.solarMat.opacity = 1;
      back.mat.transparent = true;
      back.solarMat.transparent = true;
      back.mat.depthWrite = false;
      back.solarMat.depthWrite = false;
      fade = null;
      return back;
    }
    fade = { from: shown, to: next, t0: performance.now() };
    shown = next;
    back.mat.opacity = 0;
    back.solarMat.opacity = 0;
    back.mat.transparent = true;
    back.solarMat.transparent = true;
    back.mat.depthWrite = false;
    back.solarMat.depthWrite = false;
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

  function place(slot: Slot, index: number): void {
    const theta = index * GOLDEN;
    const rho = slot.c * Math.sqrt(index + 0.5);
    dummy.position.set(Math.cos(theta) * rho, 0.02, Math.sin(theta) * rho);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    slot.mesh.setMatrixAt(index, dummy.matrix);
    slot.solar.setMatrixAt(index, dummy.matrix);
  }

  function pop(slot: Slot, index: number, now: number): number {
    if (slot.die[index]! > 0) {
      if (reducedMotion()) return 0;
      const t = Math.min(1, Math.max(0, (now - slot.die[index]!) / 250));
      return slot.side * (1 - smooth(t));
    }
    if (reducedMotion()) return slot.side;
    const delay = Math.min(index * 3, 400);
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
        : !instant && now < slot.born[i]! + Math.min(i * 3, 400) + 250;
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

  function projectedFrac(): number {
    const w = overlay.clientWidth || 800;
    const h = overlay.clientHeight || 600;
    const dist = Math.max(camera.position.length(), 1e-3);
    const fov = (camera.fov * Math.PI) / 180;
    const px = (outer / dist) * (h / 2) / Math.tan(fov / 2);
    return px / (Math.min(w, h) / 2);
  }

  function distanceFor(frac: number): number {
    const w = overlay.clientWidth || 800;
    const h = overlay.clientHeight || 600;
    const fov = (camera.fov * Math.PI) / 180;
    const px = frac * (Math.min(w, h) / 2);
    return (outer * (h / 2)) / Math.tan(fov / 2) / Math.max(px, 1);
  }

  function applyDistance(dist: number): void {
    const length = Math.max(camera.position.length(), 1e-3);
    camera.position.multiplyScalar(dist / length);
    camera.lookAt(controls.target);
    controls.update();
    fitClip(true);
  }

  function considerZoom(): void {
    if (projectedFrac() <= 0.92) return;
    const dest = distanceFor(0.75);
    const from = camera.position.length();
    if (from >= dest * 0.98) return;
    if (zoom) {
      zoom.to = Math.max(zoom.to, dest);
      return;
    }
    if (Math.abs(from - dest) / dest < 0.02) return;
    if (reducedMotion()) {
      applyDistance(dest);
      return;
    }
    zoom = { from, to: dest, t0: performance.now() };
  }

  function fit(): void {
    const dest = distanceFor(0.75);
    const from = camera.position.length();
    if (reducedMotion() || Math.abs(from - dest) / Math.max(dest, 1e-3) < 0.02) {
      zoom = null;
      applyDistance(dest);
    } else {
      zoom = { from, to: dest, t0: performance.now() };
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
        if (live) reasons.push('tile-tween');
        if (fade) {
          const other = slots[fade.from]!;
          live = tickSlot(other, now, dt) || live;
          const t = Math.min(1, (now - fade.t0) / 400);
          const e = reducedMotion() ? 1 : smooth(t);
          slots[fade.to]!.mat.opacity = e;
          slots[fade.to]!.solarMat.opacity = e;
          other.mat.opacity = 1 - e;
          other.solarMat.opacity = 1 - e;
          other.mat.transparent = true;
          other.solarMat.transparent = true;
          if (t >= 1) {
            other.mesh.count = 0;
            other.solar.count = 0;
            other.hot.length = 0;
            other.hotOn.fill(0);
            other.mat.opacity = 1;
            other.solarMat.opacity = 1;
            const front = slots[fade.to]!;
            front.mat.opacity = 1;
            front.solarMat.opacity = 1;
            fade = null;
            if (queuedK >= 0 && queuedK !== front.k) {
              const nextK = queuedK;
              queuedK = -1;
              const slot = switchTo(nextK);
              fill(slot, lastRad, lastTot);
              const text = `1 tile = ${Math.round(slot.area).toLocaleString('en-US')} m²`;
              if (chip.textContent !== text) chip.textContent = text;
            }
          }
          live = true;
          reasons.push('cross-fade');
        }
        if (zoom) {
          const t = Math.min(1, (now - zoom.t0) / 500);
          const e = 1 - (1 - t) ** 3;
          applyDistance(zoom.from + (zoom.to - zoom.from) * e);
          if (t >= 1) zoom = null;
          live = true;
          reasons.push('auto-zoom');
        }
        wake = reasons.join('+');
        publishTilePx();
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
        zoom = null;
        applyDistance(dest);
      },
      syncDom() {
        if (!overlay.isConnected || overlay.clientWidth < 2) return;
        const p = project(0, 0.2, 0);
        const dist = Math.max(camera.position.length(), 1e-3);
        const fov = (camera.fov * Math.PI) / 180;
        const hexPx = (2 / dist) * (overlay.clientHeight / 2) / Math.tan(fov / 2);
        const show = p.ok && hexPx >= 8;
        label.hidden = !show;
        leaderLine.style.display = show ? '' : 'none';
        if (!show) return;
        label.style.left = '0';
        label.style.top = '0';
        label.style.transform = `translate3d(${p.x + 18}px, ${p.y - 22}px, 0)`;
        leaderLine.setAttribute('x1', String(p.x));
        leaderLine.setAttribute('y1', String(p.y));
        leaderLine.setAttribute('x2', String(p.x + 18));
        leaderLine.setAttribute('y2', String(p.y - 14));
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

  function project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    scratch.set(x, y, z).project(camera);
    return {
      x: (scratch.x * 0.5 + 0.5) * overlay.clientWidth,
      y: (-scratch.y * 0.5 + 0.5) * overlay.clientHeight,
      ok: scratch.z < 1,
    };
  }

  return {
    layout,
    view,
    rebind() {
      controls.dispose();
      controls = createControls(camera, { min: 0.2, max: 1e8 });
      controls.enablePan = false;
      controls.target.set(0, 0, 0);
      bindControls();
      controls.update();
    },
    detach() {
      controls.dispose();
    },
  };
}

function makeSlot(): Slot {
  const geo = new BoxGeometry(1, 0.04, 1);
  const scale = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  const mix = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  geo.setAttribute('aScale', scale);
  geo.setAttribute('aMix', mix);
  const solarGeo = geo.clone();
  const solarScale = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  const solarMix = new InstancedBufferAttribute(new Float32Array(MAX), 1);
  solarGeo.setAttribute('aScale', solarScale);
  solarGeo.setAttribute('aMix', solarMix);
  const mat = createEmberMaterial({ instanced: true, heat01: 0.51 });
  const solarMat = createSolarMaterial();
  mat.envMap = null;
  mat.envMapIntensity = 0;
  const mesh = new InstancedMesh(geo, mat, MAX);
  const solar = new InstancedMesh(solarGeo, solarMat, MAX);
  mesh.layers.enable(LAYER_EMBER);
  mesh.count = 0;
  solar.count = 0;
  mesh.frustumCulled = false;
  solar.frustumCulled = false;
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
    born: new Float64Array(MAX),
    die: new Float64Array(MAX),
    mixNow: new Float32Array(MAX),
    mixTo: new Float32Array(MAX).fill(1),
    hot: [],
    hotOn: new Uint8Array(MAX),
  };
}

function pickK(area: number, current: number): number {
  const count = (k: number) => area / (5 * 10 ** k);
  if (current < 0) {
    let k = 0;
    while (count(k) > 2000 && k < 8) k += 1;
    return k;
  }
  if (count(current) > 2400) {
    let k = current;
    while (count(k) > 2400 && k < 8) k += 1;
    return k;
  }
  if (current > 0 && count(current) < 120) {
    let k = current;
    while (k > 0 && count(k) < 120) k -= 1;
    return k;
  }
  return current;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
