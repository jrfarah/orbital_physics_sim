import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene as ThreeScene,
} from 'three';
import { Scene } from 'three';
import { R_E } from '../../physics/constants';
import { H_C, SHAPE, V_SH, type ShellRow } from '../../physics/kessler';
import { createEarth } from '../../engine/earth';
import { clearUserOrbit, createControls, isMobile, makeCamera, reducedMotion, requestRender, type TabView } from '../../engine/renderer';
import { createStarfield, createSunSprite } from '../../engine/starfield';
import { r0Style } from './gauges';

const MU = 398600.4418;
const R500 = R_E + 500;
const OMEGA_500 = Math.sqrt(MU / R500 ** 3);
const TIME_SCALE = (Math.PI * 2) / (24 * OMEGA_500);
const MAX_SATS = 8192;
const MAX_DEBRIS = 3000;

const ORBIT = /* glsl */ `
vec3 orbitPos(float radius, float incl, float raan, float phase0, float omega, float time) {
  float phase = phase0 + omega * time;
  float cp = cos(phase);
  float sp = sin(phase);
  vec3 inc = vec3(radius * cp, radius * sp * cos(incl), radius * sp * sin(incl));
  float cO = cos(raan);
  float sO = sin(raan);
  return vec3(inc.x * cO - inc.y * sO, inc.x * sO + inc.y * cO, inc.z);
}
`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function omegaOf(rKm: number): number {
  return Math.sqrt(MU / rKm ** 3) * TIME_SCALE;
}

interface ShellVis {
  mesh: Mesh;
  mat: ShaderMaterial;
  radius: number;
  row: ShellRow;
}

export function createKesslerScene(tip: HTMLElement) {
  const mobile = isMobile();
  const scene = new Scene();
  const earth = createEarth(mobile);
  scene.add(earth.group, earth.sun, earth.ambient, createStarfield(mobile), createSunSprite());

  const shellGeo = new SphereGeometry(1, mobile ? 32 : 48, mobile ? 24 : 32);
  const shells: ShellVis[] = [];

  const satGeo = new PlaneGeometry(0.008, 0.008);
  const satRadius = new Float32Array(MAX_SATS);
  const satIncl = new Float32Array(MAX_SATS);
  const satRaan = new Float32Array(MAX_SATS);
  const satPhase = new Float32Array(MAX_SATS);
  const satOmega = new Float32Array(MAX_SATS);
  const satColor = new Float32Array(MAX_SATS * 3);
  satGeo.setAttribute('aRadius', new InstancedBufferAttribute(satRadius, 1));
  satGeo.setAttribute('aIncl', new InstancedBufferAttribute(satIncl, 1));
  satGeo.setAttribute('aRaan', new InstancedBufferAttribute(satRaan, 1));
  satGeo.setAttribute('aPhase0', new InstancedBufferAttribute(satPhase, 1));
  satGeo.setAttribute('aOmega', new InstancedBufferAttribute(satOmega, 1));
  satGeo.setAttribute('aColor', new InstancedBufferAttribute(satColor, 3));
  const satMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aRadius;
      attribute float aIncl;
      attribute float aRaan;
      attribute float aPhase0;
      attribute float aOmega;
      attribute vec3 aColor;
      uniform float uTime;
      varying vec3 vColor;
      varying vec2 vUv;
      ${ORBIT}
      void main() {
        vColor = aColor;
        vUv = uv;
        vec3 world = orbitPos(aRadius, aIncl, aRaan, aPhase0, aOmega, uTime);
        vec4 mv = modelViewMatrix * vec4(world, 1.0);
        mv.xy += position.xy;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        if (dot(d, d) > 0.22) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });
  const sats = new InstancedMesh(satGeo, satMat, MAX_SATS);
  sats.count = 0;
  sats.frustumCulled = false;
  scene.add(sats);

  const debrisGeo = new BufferGeometry();
  const dRadius = new Float32Array(MAX_DEBRIS);
  const dIncl = new Float32Array(MAX_DEBRIS);
  const dRaan = new Float32Array(MAX_DEBRIS);
  const dPhase = new Float32Array(MAX_DEBRIS);
  const dOmega = new Float32Array(MAX_DEBRIS);
  debrisGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3));
  debrisGeo.setAttribute('aRadius', new BufferAttribute(dRadius, 1));
  debrisGeo.setAttribute('aIncl', new BufferAttribute(dIncl, 1));
  debrisGeo.setAttribute('aRaan', new BufferAttribute(dRaan, 1));
  debrisGeo.setAttribute('aPhase0', new BufferAttribute(dPhase, 1));
  debrisGeo.setAttribute('aOmega', new BufferAttribute(dOmega, 1));
  const debrisMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aRadius;
      attribute float aIncl;
      attribute float aRaan;
      attribute float aPhase0;
      attribute float aOmega;
      uniform float uTime;
      ${ORBIT}
      void main() {
        vec3 world = orbitPos(aRadius, aIncl, aRaan, aPhase0, aOmega, uTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        gl_PointSize = 1.2;
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(0.545, 0.584, 0.639, 0.5);
      }
    `,
  });
  const debris = new Points(debrisGeo, debrisMat);
  debris.frustumCulled = false;
  scene.add(debris);

  const camera = makeCamera();
  camera.position.set(3.4, 1.8, 3.6);
  let controls = createControls(camera, { min: 1.3, max: 12 });
  controls.target.set(0, 0, 0);
  controls.update();

  let paused = reducedMotion();
  let showDebris = true;
  let time = 0;
  let quality = 0;
  let lastRows: ShellRow[] = [];
  let sig = '';
  let instances = 0;
  const rayOrigin = new Vector3();
  const rayDir = new Vector3();

  function budget(): number {
    return Math.max(200, Math.floor((mobile ? 2500 : 6000) / 2 ** quality));
  }
  function debrisBudget(): number {
    return Math.max(200, Math.floor((mobile ? 1200 : 3000) / 2 ** quality));
  }

  function clearShells(): void {
    for (const shell of shells) {
      scene.remove(shell.mesh);
      shell.mat.dispose();
    }
    shells.length = 0;
  }

  function buildShells(rows: ShellRow[]): void {
    clearShells();
    if (rows.length === 0) {
      sats.count = 0;
      instances = 0;
      return;
    }
    const logs = rows.map((row) => Math.log10(Math.max(row.N, 1)));
    const lo = Math.min(...logs);
    const hi = Math.max(...logs);
    for (const row of rows) {
      const style = r0Style(row.R0);
      const mat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new Color().setRGB(style.rgb[0], style.rgb[1], style.rgb[2]) },
          uOpacity: { value: 0.05 + 0.13 * (hi === lo ? 1 : (Math.log10(Math.max(row.N, 1)) - lo) / (hi - lo)) },
          uPulse: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uPulse;
          void main() {
            float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
            gl_FragColor = vec4(uColor, uOpacity * mix(0.2, 1.0, fres) * uPulse);
          }
        `,
      });
      const mesh = new Mesh(shellGeo, mat);
      const radius = 1 + row.h / R_E;
      mesh.scale.setScalar(radius);
      scene.add(mesh);
      shells.push({ mesh, mat, radius, row });
    }
  }

  function paintColors(rows: ShellRow[]): void {
    const byH = new Map(rows.map((row) => [row.h, row]));
    let sat = 0;
    for (const shell of shells) {
      const row = byH.get(shell.row.h) ?? shell.row;
      shell.row = row;
      const style = r0Style(row.R0);
      (shell.mat.uniforms.uColor.value as Color).setRGB(style.rgb[0], style.rgb[1], style.rgb[2]);
      const count = Math.round(shell.mesh.userData.count as number);
      for (let i = 0; i < count; i++) {
        satColor[(sat + i) * 3] = style.rgb[0];
        satColor[(sat + i) * 3 + 1] = style.rgb[1];
        satColor[(sat + i) * 3 + 2] = style.rgb[2];
      }
      sat += count;
    }
    (satGeo.getAttribute('aColor') as InstancedBufferAttribute).needsUpdate = true;
  }

  function buildSats(rows: ShellRow[]): void {
    const cap = budget();
    const weights = rows.map((row) => row.N);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const base = 30;
    const extra = Math.max(0, cap - base * rows.length);
    const rng = mulberry32(0x6e55);
    const incs = [53, 70, 97.6, 30].map((d) => (d * Math.PI) / 180);
    const weightsInc = [0.35, 0.15, 0.35, 0.15];
    let cursor = 0;
    rows.forEach((row, index) => {
      const count = Math.min(MAX_SATS - cursor, base + Math.floor((extra * weights[index]) / sum));
      shells[index].mesh.userData.count = count;
      const style = r0Style(row.R0);
      for (let i = 0; i < count; i++) {
        const n = cursor + i;
        const jitter = (rng() * 2 - 1) * 0.4 * (50 / R_E);
        const rScene = 1 + row.h / R_E + jitter;
        satRadius[n] = rScene;
        let pick = rng();
        let inc = incs[3];
        let acc = 0;
        for (let k = 0; k < 4; k++) {
          acc += weightsInc[k];
          if (pick <= acc) {
            inc = incs[k];
            break;
          }
        }
        satIncl[n] = inc;
        satRaan[n] = rng() * Math.PI * 2;
        satPhase[n] = rng() * Math.PI * 2;
        satOmega[n] = omegaOf(rScene * R_E);
        satColor[n * 3] = style.rgb[0];
        satColor[n * 3 + 1] = style.rgb[1];
        satColor[n * 3 + 2] = style.rgb[2];
      }
      cursor += count;
    });
    instances = cursor;
    sats.count = cursor;
    for (const name of ['aRadius', 'aIncl', 'aRaan', 'aPhase0', 'aOmega', 'aColor']) {
      satGeo.getAttribute(name).needsUpdate = true;
    }
  }

  function buildDebris(): void {
    const n = Math.min(MAX_DEBRIS, debrisBudget());
    const weight = SHAPE.map((shape, i) => shape * V_SH[i]);
    const total = weight.reduce((a, b) => a + b, 0);
    const rng = mulberry32(0xdeb5);
    const incs = [53, 70, 97.6, 30].map((d) => (d * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      let x = rng() * total;
      let shell = H_C.length - 1;
      for (let k = 0; k < weight.length; k++) {
        x -= weight[k];
        if (x <= 0) {
          shell = k;
          break;
        }
      }
      const h = H_C[shell] + (rng() * 2 - 1) * 25;
      const rScene = 1 + h / R_E;
      dRadius[i] = rScene;
      dIncl[i] = incs[Math.floor(rng() * incs.length)];
      dRaan[i] = rng() * Math.PI * 2;
      dPhase[i] = rng() * Math.PI * 2;
      dOmega[i] = omegaOf(Math.max(R_E + 200, rScene * R_E));
    }
    debrisGeo.setDrawRange(0, n);
    for (const name of ['aRadius', 'aIncl', 'aRaan', 'aPhase0', 'aOmega']) {
      debrisGeo.getAttribute(name).needsUpdate = true;
    }
    debris.visible = showDebris;
  }

  function apply(rows: ShellRow[]): number {
    lastRows = rows;
    const next = `${budget()}|${rows.map((row) => `${row.h}:${row.N.toExponential(4)}`).join(',')}`;
    if (next !== sig) {
      sig = next;
      buildShells(rows);
      buildSats(rows);
      buildDebris();
    } else paintColors(rows);
    requestRender();
    return instances;
  }

  function dom(): HTMLElement | SVGElement {
    const node = controls.domElement;
    if (!node) throw new Error('controls have no element');
    return node;
  }

  function onMove(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    const canvas = dom();
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    rayOrigin.set(ndcX, ndcY, 0.5).unproject(camera);
    rayDir.copy(rayOrigin).sub(camera.position).normalize();
    const origin = camera.position;
    let best: { t: number; shell: ShellVis } | null = null;
    for (const shell of shells) {
      const b = origin.dot(rayDir);
      const c = origin.lengthSq() - shell.radius * shell.radius;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && (!best || t < best.t)) best = { t, shell };
    }
    if (!best) {
      tip.hidden = true;
      return;
    }
    const host = canvas.parentElement;
    if (!host) return;
    if (tip.parentElement !== host) host.append(tip);
    const box = host.getBoundingClientRect();
    tip.hidden = false;
    tip.className = 'shell-tip card';
    tip.style.whiteSpace = 'pre-line';
    tip.style.left = `${event.clientX - box.left + 12}px`;
    tip.style.top = `${event.clientY - box.top + 12}px`;
    const row = best.shell.row;
    tip.textContent = `${row.hLo}-${row.hHi} km\nSatellites: ${Math.round(row.N).toLocaleString('en-US')}\nCritical number: ${Math.round(row.Ncrit).toLocaleString('en-US')}\nR₀ = ${row.R0.toPrecision(3)}\nDebris lifetime: ${Math.round(row.tau).toLocaleString('en-US')} years`;
  }

  function hideTip(): void {
    tip.hidden = true;
  }

  function bind(): void {
    const canvas = dom();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', hideTip);
  }
  function unbind(): void {
    const canvas = dom();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', hideTip);
    hideTip();
  }

  function view(): TabView {
    return {
      scene: scene as ThreeScene,
      camera,
      controls,
      update(dt) {
        const play = !paused;
        if (!play) return false;
        time += dt;
        satMat.uniforms.uTime.value = time;
        debrisMat.uniforms.uTime.value = time;
        const pulse = 1 + 0.15 * Math.sin(Math.PI * time);
        for (const shell of shells) shell.mat.uniforms.uPulse.value = r0Style(shell.row.R0).pulse ? pulse : 1;
        return true;
      },
      resetView() {
        clearUserOrbit(controls);
        camera.position.set(3.4, 1.8, 3.6);
        controls.target.set(0, 0, 0);
        controls.update();
        requestRender();
      },
      onResize() {
        camera.position.set(3.4, 1.8, 3.6);
        controls.target.set(0, 0, 0);
        controls.update();
      },
      onQualityDrop(level) {
        quality = level;
        sig = '';
        if (lastRows.length) apply(lastRows);
      },
    };
  }

  return {
    view,
    apply,
    instanceCount: () => instances,
    setPaused(on: boolean) {
      paused = on;
      if (!paused) requestRender();
    },
    setDebris(on: boolean) {
      showDebris = on;
      debris.visible = on;
      requestRender();
    },
    rebind() {
      controls.dispose();
      const target = controls.target.clone();
      controls = createControls(camera, { min: 1.3, max: 12 });
      controls.target.copy(target);
      controls.update();
      bind();
    },
    detach() {
      unbind();
      controls.dispose();
    },
  };
}
