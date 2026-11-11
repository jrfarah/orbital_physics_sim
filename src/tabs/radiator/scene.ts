import {
  ArrowHelper,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Scene,
  Sphere,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { R_E } from '../../physics/constants';
import type { FaceFlux, RadiatorResult } from '../../physics/radiator';
import type { Vec3 } from '../../physics/vec';
import { createEarth } from '../../engine/earth';
import { createHeatMaterial, setHeat, type HeatMaterial } from '../../engine/heatMaterial';
import { createControls, makeCamera, reducedMotion, requestRender, type TabView } from '../../engine/renderer';
import { createStarfield, createSunSprite } from '../../engine/starfield';

const T_COLD = 150;
const T_HOT = 400;

function heat01(t: number): number {
  return Math.min(1, Math.max(0, (t - T_COLD) / (T_HOT - T_COLD)));
}

function v3(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

function makeSprite(text: string, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = color;
  g.font = '700 80px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.08, 0.08, 1);
  return sprite;
}

function writeCircle(attr: BufferAttribute, radius: number, center: Vector3, a: Vector3, b: Vector3): void {
  const n = attr.count;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = center.x + radius * (Math.cos(t) * a.x + Math.sin(t) * b.x);
    const y = center.y + radius * (Math.cos(t) * a.y + Math.sin(t) * b.y);
    const z = center.z + radius * (Math.cos(t) * a.z + Math.sin(t) * b.z);
    attr.setXYZ(i, x, y, z);
  }
  attr.needsUpdate = true;
}

export function createRadiatorScene(mobile: boolean, tag: HTMLElement) {
  const scene = new Scene();
  scene.add(createStarfield(mobile));
  scene.add(createSunSprite());
  const earth = createEarth(mobile);
  scene.add(earth.group);
  scene.add(earth.sun);
  scene.add(earth.ambient);

  const matA = createHeatMaterial(0);
  const matB = createHeatMaterial(0);
  const edge = new MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.85, roughness: 0.45 });
  const panel = new Mesh(new BoxGeometry(0.09, 0.06, 0.004), [edge, edge, edge, edge, matA, matB]);
  scene.add(panel);
  const labelA = makeSprite('A', '#5ce1ff');
  const labelB = makeSprite('B', '#ffb547');
  scene.add(labelA, labelB);
  const arrowA = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 0.12, 0x5ce1ff);
  const arrowB = new ArrowHelper(new Vector3(0, -1, 0), new Vector3(), 0.12, 0xffb547);
  scene.add(arrowA, arrowB);

  const orbitGeo = new BufferGeometry();
  orbitGeo.setAttribute('position', new BufferAttribute(new Float32Array(128 * 3), 3));
  const orbit = new LineLoop(orbitGeo, new LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35 }));
  const horizonGeo = new BufferGeometry();
  horizonGeo.setAttribute('position', new BufferAttribute(new Float32Array(96 * 3), 3));
  const horizon = new LineLoop(horizonGeo, new LineBasicMaterial({ color: 0x9aa9bb, transparent: true, opacity: 0.45 }));
  const lineMatA = new LineBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.4 });
  const lineMatB = new LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.4 });
  const lineA = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), lineMatA);
  const lineB = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), lineMatB);
  const views = new Group();
  views.add(orbit, horizon, lineA, lineB);
  scene.add(views);

  const camera = makeCamera();
  camera.position.set(2.4, 1.2, 2.4);
  let controls = createControls(camera, { min: 0.45, max: 12 });
  controls.target.set(0, 0, 0);
  controls.update();

  const homePos = new Vector3(2.4, 1.2, 2.4);
  const homeTarget = new Vector3();
  let focus: { from: Vector3; to: Vector3; fromT: Vector3; toT: Vector3; t0: number } | null = null;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const sphere = new Sphere(new Vector3(), 1);
  const projected = new Vector3();
  let drag = false;
  let dragging = false;
  let onDrag: ((phi: number, theta: number) => void) | null = null;

  const canvas = () => controls.domElement as HTMLCanvasElement;
  const onPointerDown = (event: PointerEvent) => {
    if (!drag || event.button !== 0) return;
    dragging = true;
    move(event);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    move(event);
  };
  const onPointerUp = () => {
    dragging = false;
  };
  function move(event: PointerEvent): void {
    const rect = canvas().getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const point = raycaster.ray.intersectSphere(sphere, hit);
    if (!point || !onDrag) return;
    const p = point.normalize();
    const theta = Math.asin(Math.min(1, Math.max(-1, p.y)));
    const phi = Math.atan2(-p.z, p.x);
    onDrag((phi * 180) / Math.PI, (theta * 180) / Math.PI);
  }

  function view(): TabView {
    return {
      scene,
      camera,
      controls,
      update(dt) {
        void dt;
        if (!focus) return false;
        const t = reducedMotion() ? 1 : Math.min(1, (performance.now() - focus.t0) / 600);
        const e = 1 - (1 - t) ** 3;
        camera.position.lerpVectors(focus.from, focus.to, e);
        controls.target.lerpVectors(focus.fromT, focus.toT, e);
        if (t >= 1) focus = null;
        return focus !== null || t < 1;
      },
      resetView() {
        focus = null;
        camera.position.copy(homePos);
        controls.target.copy(homeTarget);
        controls.update();
        requestRender();
      },
      syncDom() {
        const w = canvas().parentElement?.clientWidth ?? 1;
        const h = canvas().parentElement?.clientHeight ?? 1;
        projected.copy(panel.position).project(camera);
        tag.style.left = `${(projected.x * 0.5 + 0.5) * w}px`;
        tag.style.top = `${(-projected.y * 0.5 + 0.5) * h + 18}px`;
        tag.hidden = projected.z > 1;
      },
    };
  }

  return {
    view,
    rebind() {
      controls.dispose();
      const target = controls.target.clone();
      controls = createControls(camera, { min: 0.45, max: 12 });
      controls.target.copy(target);
      controls.enableRotate = !drag;
      controls.update();
    },
    detach() {
      controls.dispose();
    },
    setDrag(on: boolean, cb: (phi: number, theta: number) => void) {
      drag = on;
      onDrag = cb;
      controls.enableRotate = !on;
      dragging = false;
      const node = canvas();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      if (on) {
        node.addEventListener('pointerdown', onPointerDown);
        node.addEventListener('pointermove', onPointerMove);
        node.addEventListener('pointerup', onPointerUp);
      }
    },
    focusPanel() {
      const from = camera.position.clone();
      const fromT = controls.target.clone();
      const toT = panel.position.clone();
      const dir = from.clone().sub(fromT);
      if (dir.length() < 1e-4) dir.set(1, 0.4, 1);
      dir.normalize();
      const to = toT.clone().add(dir.multiplyScalar(0.6));
      if (reducedMotion()) {
        camera.position.copy(to);
        controls.target.copy(toT);
        controls.update();
        requestRender();
        return;
      }
      focus = { from, to, fromT, toT, t0: performance.now() };
      requestRender();
    },
    update(hKm: number, rHat: Vec3, nHat: Vec3, east: Vec3, result: RadiatorResult, showView: boolean) {
      const r = v3(rHat);
      const n = v3(nHat).normalize();
      const e = v3(east).normalize();
      const radial = r.clone().normalize();
      const satR = 1 + hKm / R_E;
      const pos = radial.clone().multiplyScalar(satR);
      let x = new Vector3().crossVectors(e, n);
      if (x.lengthSq() < 1e-8) x.crossVectors(new Vector3(0, 1, 0), n);
      if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
      x.normalize();
      const y = new Vector3().crossVectors(n, x).normalize();
      panel.position.copy(pos);
      panel.matrix.makeBasis(x, y, n);
      panel.matrix.setPosition(pos);
      panel.matrixAutoUpdate = false;
      panel.matrixWorldNeedsUpdate = true;
      setHeat(matA, heat01(result.A.T_sink));
      setHeat(matB, heat01(result.B.T_sink));
      labelA.position.copy(pos).addScaledVector(n, 0.07);
      labelB.position.copy(pos).addScaledVector(n, -0.07);
      arrowA.position.copy(pos);
      arrowA.setDirection(n);
      arrowB.position.copy(pos);
      arrowB.setDirection(n.clone().multiplyScalar(-1));
      const up = new Vector3().crossVectors(radial, e).normalize();
      writeCircle(orbitGeo.getAttribute('position') as BufferAttribute, satR, new Vector3(), radial, e.lengthSq() ? e : up);
      const H = satR;
      const dist = 1 / H;
      const ringR = Math.sqrt(Math.max(0, 1 - dist * dist));
      const center = radial.clone().multiplyScalar(dist);
      const t1 = e.clone().normalize();
      const t2 = new Vector3().crossVectors(radial, t1).normalize();
      writeCircle(horizonGeo.getAttribute('position') as BufferAttribute, ringR, center, t1, t2);
      setLine(lineA, pos, result.A);
      setLine(lineB, pos, result.B);
      views.visible = showView;
      sphere.radius = satR;
    },
    dispose() {
      controls.dispose();
      earth.dispose();
      panel.geometry.dispose();
      edge.dispose();
      (matA as HeatMaterial).dispose();
      (matB as HeatMaterial).dispose();
    },
  };
}

function setLine(line: Line, pos: Vector3, face: FaceFlux): void {
  const attr = line.geometry.getAttribute('position') as BufferAttribute;
  attr.setXYZ(0, pos.x, pos.y, pos.z);
  attr.setXYZ(1, 0, 0, 0);
  attr.needsUpdate = true;
  line.visible = face.F > 0.01;
}
