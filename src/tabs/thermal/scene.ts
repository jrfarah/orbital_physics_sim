import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createHeatMaterial, setHeat } from '../../engine/heatMaterial';
import { clearUserOrbit, createControls, makeCamera, reducedMotion, requestRender, type TabView } from '../../engine/renderer';
import { createStarfield } from '../../engine/starfield';

const MAX = 4000;
const GOLDEN = 137.50776 * (Math.PI / 180);
const T_COLD = 300;
const T_HOT = 650;

export function createThermalScene(label: HTMLElement) {
  const scene = new Scene();
  scene.add(createStarfield(false));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(8, 12, 6);
  scene.add(key, new AmbientLight(0xffffff, 0.35));
  const side = new MeshStandardMaterial({ color: 0x23272e, metalness: 0.8, roughness: 0.45 });
  const top = new MeshStandardMaterial({
    color: 0x0e2c33,
    emissive: 0x1ad4ff,
    emissiveIntensity: 0.55,
    metalness: 0.15,
    roughness: 0.35,
  });
  const core = new Mesh(new CylinderGeometry(0.8, 0.8, 0.5, 6), [side, top, side]);
  scene.add(core);

  const geo = new RoundedBoxGeometry(1, 0.06, 0.82, 2, 0.08);
  const mat = createHeatMaterial(0, true);
  const mesh = new InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  const aScale = new Float32Array(MAX);
  const aMix = new Float32Array(MAX);
  const targetScale = new Float32Array(MAX);
  const targetMix = new Float32Array(MAX);
  const delay = new Float32Array(MAX);
  geo.setAttribute('aScale', new InstancedBufferAttribute(aScale, 1));
  geo.setAttribute('aMix', new InstancedBufferAttribute(aMix, 1));
  mesh.count = 0;
  scene.add(mesh);

  const ringGeo = circleGeo();
  const dashGeo = circleGeo();
  const ring = new LineLoop(ringGeo, new LineBasicMaterial({ color: 0x5ce1ff }));
  const dashMat = new LineDashedMaterial({ color: 0x9aa9bb, dashSize: 0.2, gapSize: 0.12 });
  const dash = new LineLoop(dashGeo, dashMat);
  scene.add(ring, dash);

  const camera = makeCamera();
  placeCamera(camera);
  let controls = createControls(camera, { min: 4, max: 60 });
  controls.target.set(0, 0, 0);
  controls.update();
  const dummy = new Object3D();
  let tileArea = 5;
  let high = 0;
  let tweening = false;

  function layout(nRad: number, nSol: number, area: number, noPumpArea: number, temp: number) {
    const n = Math.min(MAX, nRad + nSol);
    const c = Math.sqrt(tileArea / Math.PI) / 10;
    const sideScale = (0.82 * Math.sqrt(tileArea)) / 10;
    const snap = reducedMotion();
    for (let i = 0; i < MAX; i++) {
      const alive = i < n;
      if (!alive && i >= high) break;
      if (alive && aScale[i] < 0.02 && targetScale[i] === 0) delay[i] = snap ? 0 : Math.min(i, 400) * 0.003;
      targetScale[i] = alive ? 1 : 0;
      if (alive) targetMix[i] = i < nRad ? 0 : 1;
      if (snap) {
        aScale[i] = targetScale[i];
        aMix[i] = alive ? targetMix[i] : aMix[i];
        delay[i] = 0;
      }
      if (i < Math.max(high, n)) {
        const radius = c * Math.sqrt(i + 0.5);
        const ang = i * GOLDEN;
        dummy.position.set(Math.cos(ang) * radius, 0, Math.sin(ang) * radius);
        dummy.scale.set(sideScale, 1, sideScale);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    high = Math.max(n, high);
    mesh.count = high;
    mesh.instanceMatrix.needsUpdate = true;
    (geo.getAttribute('aScale') as InstancedBufferAttribute).needsUpdate = true;
    (geo.getAttribute('aMix') as InstancedBufferAttribute).needsUpdate = true;
    tweening = !snap;
    const heat = Math.min(1, Math.max(0, (temp - T_COLD) / (T_HOT - T_COLD)));
    setHeat(mat, heat);
    setRing(ringGeo, Math.sqrt(area / Math.PI) / 10);
    setRing(dashGeo, Math.sqrt(noPumpArea / Math.PI) / 10);
    dash.computeLineDistances();
    requestRender();
  }

  function view(): TabView {
    return {
      scene,
      camera,
      controls,
      update(dt) {
        if (!tweening) return false;
        let live = false;
        const snap = reducedMotion();
        for (let i = 0; i < high; i++) {
          if (delay[i] > 0) {
            delay[i] = snap ? 0 : delay[i] - dt;
            live = true;
            continue;
          }
          const ds = targetScale[i] - aScale[i];
          const dm = targetMix[i] - aMix[i];
          if (Math.abs(ds) > 0.004) {
            aScale[i] += snap ? ds : ds * Math.min(1, dt / 0.25);
            live = true;
          } else aScale[i] = targetScale[i];
          if (Math.abs(dm) > 0.004) {
            aMix[i] += snap ? dm : dm * Math.min(1, dt / 0.3);
            live = true;
          } else aMix[i] = targetMix[i];
        }
        (geo.getAttribute('aScale') as InstancedBufferAttribute).needsUpdate = true;
        (geo.getAttribute('aMix') as InstancedBufferAttribute).needsUpdate = true;
        tweening = live;
        return live;
      },
      resetView() {
        clearUserOrbit(controls);
        placeCamera(camera);
        controls.target.set(0, 0, 0);
        controls.update();
        requestRender();
      },
      onResize() {
        placeCamera(camera);
        controls.target.set(0, 0, 0);
        controls.update();
      },
      syncDom() {
        const host = controls.domElement?.parentElement ?? null;
        if (!host) return;
        const edge = ringGeo.getAttribute('position') as BufferAttribute;
        const x = edge.getX(0);
        const z = edge.getZ(0);
        const v = dummy.position.set(x, 0, z).project(camera);
        label.style.left = `${(v.x * 0.5 + 0.5) * host.clientWidth}px`;
        label.style.top = `${(-v.y * 0.5 + 0.5) * host.clientHeight}px`;
      },
    };
  }

  return {
    view,
    setTileArea(area: number) {
      tileArea = area;
    },
    layout,
    rebind() {
      controls.dispose();
      const target = controls.target.clone();
      controls = createControls(camera, { min: 4, max: 60 });
      controls.target.copy(target);
      controls.update();
    },
    detach() {
      controls.dispose();
    },
    tileLabel: '',
    dispose() {
      controls.dispose();
      geo.dispose();
      mat.dispose();
      side.dispose();
      top.dispose();
    },
  };

  function placeCamera(cam: { position: { set: (x: number, y: number, z: number) => void } }) {
    const elev = (35 * Math.PI) / 180;
    const dist = 16;
    cam.position.set(dist * Math.cos(elev) * 0.4, dist * Math.sin(elev), dist * Math.cos(elev) * 0.9);
  }
}

function circleGeo(): BufferGeometry {
  const n = 96;
  const pos = new Float32Array(n * 3);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  return geo;
}

function setRing(geo: BufferGeometry, radius: number): void {
  const attr = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < attr.count; i++) {
    const t = (i / attr.count) * Math.PI * 2;
    attr.setXYZ(i, Math.cos(t) * radius, 0.02, Math.sin(t) * radius);
  }
  attr.needsUpdate = true;
  geo.computeBoundingSphere();
}
