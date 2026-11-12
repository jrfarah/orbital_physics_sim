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
  Mesh,
  MeshStandardMaterial,
  Object3D,
  DynamicDrawUsage,
  Scene,
  Vector3,
} from 'three';
import { createHeatMaterial, setHeat, type HeatMaterial } from '../../engine/heatMaterial';
import {
  clearUserOrbit,
  createControls,
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
  mat: HeatMaterial;
  scale: InstancedBufferAttribute;
  mix: InstancedBufferAttribute;
  k: number;
  area: number;
  side: number;
  c: number;
  count: number;
  born: Float64Array;
  die: Float64Array;
  mixNow: Float32Array;
  mixTo: Float32Array;
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
  scene.add(slots[0].mesh, slots[1].mesh);
  let shown = 0;
  let outer = 4;
  let fade: { from: number; to: number; t0: number } | null = null;
  let zoom: Zoom | null = null;
  let userAdjusted = false;

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
  function bindControls(): void {
    controls.addEventListener('start', onStart);
  }
  bindControls();

  function layout(next: ThermalLayout, zoomOut = false): void {
    const area = Math.max(next.aTot, 1);
    const k = pickK(area, slots[shown].k);
    const slot = ensureLevel(k);
    const heat = Math.min(1, Math.max(0, (next.tHot - 210) / 360));
    setHeat(slots[0].mat, heat);
    setHeat(slots[1].mat, heat);
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

  function ensureLevel(k: number): Slot {
    const front = slots[shown]!;
    if (front.k === k) return front;
    const next = 1 - shown;
    const back = slots[next]!;
    back.k = k;
    back.area = 5 * 10 ** k;
    back.side = Math.sqrt(back.area) * 0.92;
    back.c = Math.sqrt((1.25 * back.area) / Math.PI);
    back.count = 0;
    back.die.fill(0);
    if (reducedMotion() || front.count === 0) {
      front.mesh.count = 0;
      shown = next;
      back.mat.opacity = 1;
      back.mat.transparent = false;
      back.mat.depthWrite = true;
      fade = null;
      return back;
    }
    fade = { from: shown, to: next, t0: performance.now() };
    shown = next;
    back.mat.opacity = 0;
    back.mat.transparent = true;
    back.mat.depthWrite = false;
    back.mesh.renderOrder = 2;
    front.mesh.renderOrder = 1;
    return back;
  }

  function fill(slot: Slot, aRad: number, aTot: number): void {
    const now = performance.now();
    const instant = fade !== null;
    const total = Math.min(MAX, Math.max(1, Math.round(aTot / slot.area)));
    const nRad = Math.min(total, Math.max(0, Math.round(aRad / slot.area)));
    const prev = slot.count;
    for (let i = 0; i < total; i++) {
      const revived = slot.die[i]! > 0;
      if (i >= prev || revived) {
        slot.born[i] = instant ? now - 2000 : now;
        slot.die[i] = 0;
        place(slot, i);
        slot.mixNow[i] = i < nRad ? 0 : 1;
      }
      slot.mixTo[i] = i < nRad ? 0 : 1;
    }
    for (let i = total; i < prev; i++) {
      if (slot.die[i] === 0) slot.die[i] = now;
    }
    let drawn = total;
    for (let i = total; i < MAX; i++) {
      if (slot.die[i]! > 0 && now - slot.die[i]! < 280) drawn = i + 1;
    }
    slot.count = total;
    slot.mesh.count = drawn;
    slot.mesh.instanceMatrix.needsUpdate = true;
    outer = slot.c * Math.sqrt(Math.max(total - 1, 0) + 0.5) + slot.side;
  }

  function place(slot: Slot, index: number): void {
    const theta = index * GOLDEN;
    const rho = slot.c * Math.sqrt(index + 0.5);
    dummy.position.set(Math.cos(theta) * rho, 0.02, Math.sin(theta) * rho);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    slot.mesh.setMatrixAt(index, dummy.matrix);
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
    if (slot.mesh.count === 0) return false;
    let live = false;
    let drawn = 0;
    const mixStep = Math.min(1, dt / 0.3);
    for (let i = 0; i < slot.mesh.count; i++) {
      const size = pop(slot, i, now);
      slot.scale.setX(i, size);
      const target = slot.mixTo[i] ?? 1;
      const current = slot.mixNow[i] ?? target;
      if (Math.abs(current - target) > 0.004) {
        slot.mixNow[i] = current + (target - current) * mixStep;
        live = true;
      }
      slot.mix.setX(i, slot.mixNow[i] ?? target);
      if (size > 0.001) drawn = i + 1;
      if (slot.die[i]! > 0) {
        if (now - slot.die[i]! < 280) live = true;
      } else if (now < slot.born[i]! + Math.min(i * 3, 400) + 250) {
        live = true;
      }
    }
    slot.scale.needsUpdate = true;
    slot.mix.needsUpdate = true;
    if (drawn < slot.mesh.count) slot.mesh.count = Math.max(drawn, slot.count);
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
    camera.near = Math.max(0.02, dist / 2000);
    camera.far = Math.max(dist * 40, 1000);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
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
        setEmberGlare(0);
        const now = performance.now();
        let live = tickSlot(slots[shown]!, now, dt);
        if (fade) {
          const other = slots[fade.from]!;
          live = tickSlot(other, now, dt) || live;
          const t = Math.min(1, (now - fade.t0) / 400);
          const e = reducedMotion() ? 1 : smooth(t);
          slots[fade.to]!.mat.opacity = e;
          other.mat.opacity = 1 - e;
          other.mat.transparent = true;
          if (t >= 1) {
            other.mesh.count = 0;
            other.mat.opacity = 1;
            other.mat.transparent = false;
            const front = slots[fade.to]!;
            front.mat.opacity = 1;
            front.mat.transparent = false;
            front.mat.depthWrite = true;
            fade = null;
          }
          live = true;
        }
        if (zoom) {
          const t = Math.min(1, (now - zoom.t0) / 500);
          const e = 1 - (1 - t) ** 3;
          applyDistance(zoom.from + (zoom.to - zoom.from) * e);
          if (t >= 1) zoom = null;
          live = true;
        }
        return live;
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
  const mat = createHeatMaterial(0.2, true);
  mat.envMap = null;
  mat.envMapIntensity = 0;
  const mesh = new InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return {
    mesh,
    mat,
    scale,
    mix,
    k: -1,
    area: 5,
    side: Math.sqrt(5) * 0.92,
    c: Math.sqrt((1.25 * 5) / Math.PI),
    count: 0,
    born: new Float64Array(MAX),
    die: new Float64Array(MAX),
    mixNow: new Float32Array(MAX),
    mixTo: new Float32Array(MAX).fill(1),
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
