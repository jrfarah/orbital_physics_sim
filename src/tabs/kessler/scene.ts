import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Mesh,
  OneFactor,
  OneMinusSrcColorFactor,
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
import { orbitPosition } from './orbit';
import { el } from '../../ui/readout';

const MU = 398600.4418;
const R500 = R_E + 500;
const OMEGA_500 = Math.sqrt(MU / R500 ** 3);
const TIME_SCALE = (Math.PI * 2) / (24 * OMEGA_500);
const MAX_SATS = 8192;
const MAX_DEBRIS = 1500;

const ORBIT = /* glsl */ `
vec3 orbitPos(float radius, float incl, float raan, float phase0, float omega, float time) {
  float u = phase0 + omega * time;
  float cu = cos(u);
  float su = sin(u);
  float cO = cos(raan);
  float sO = sin(raan);
  float ci = cos(incl);
  float si = sin(incl);
  float X = radius * (cO * cu - sO * su * ci);
  float Y = radius * (sO * cu + cO * su * ci);
  float Z = radius * (su * si);
  return vec3(X, Z, -Y);
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

  const satGeo = new BufferGeometry();
  const satRadius = new Float32Array(MAX_SATS);
  const satIncl = new Float32Array(MAX_SATS);
  const satRaan = new Float32Array(MAX_SATS);
  const satPhase = new Float32Array(MAX_SATS);
  const satOmega = new Float32Array(MAX_SATS);
  const satColor = new Float32Array(MAX_SATS * 3);
  satGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SATS * 3), 3));
  satGeo.setAttribute('aRadius', new BufferAttribute(satRadius, 1));
  satGeo.setAttribute('aIncl', new BufferAttribute(satIncl, 1));
  satGeo.setAttribute('aRaan', new BufferAttribute(satRaan, 1));
  satGeo.setAttribute('aPhase0', new BufferAttribute(satPhase, 1));
  satGeo.setAttribute('aOmega', new BufferAttribute(satOmega, 1));
  satGeo.setAttribute('aColor', new BufferAttribute(satColor, 3));
  const satMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPointSize: { value: 2 } },
    vertexShader: /* glsl */ `
      attribute float aRadius;
      attribute float aIncl;
      attribute float aRaan;
      attribute float aPhase0;
      attribute float aOmega;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uPointSize;
      varying vec3 vColor;
      ${ORBIT}
      void main() {
        vColor = aColor;
        vec3 world = orbitPos(aRadius, aIncl, aRaan, aPhase0, aOmega, uTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
        gl_PointSize = uPointSize;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });
  const sats = new Points(satGeo, satMat);
  sats.frustumCulled = false;
  sats.renderOrder = 3;
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
        gl_FragColor = vec4(0.545, 0.584, 0.639, 0.3);
      }
    `,
  });
  const debris = new Points(debrisGeo, debrisMat);
  debris.frustumCulled = false;
  debris.renderOrder = 1;
  scene.add(debris);

  const POOL = 512;
  const flashPos = new Float32Array(POOL * 3);
  const flashAge = new Float32Array(POOL);
  const flashKind = new Float32Array(POOL);
  const flashLife = new Float32Array(POOL);
  const flashVel = new Float32Array(POOL * 3);
  const flashGeo = new BufferGeometry();
  flashGeo.setAttribute('position', new BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('aAge', new BufferAttribute(flashAge, 1));
  flashGeo.setAttribute('aKind', new BufferAttribute(flashKind, 1));
  flashGeo.setAttribute('aLife', new BufferAttribute(flashLife, 1));
  const flashMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aKind;
      attribute float aLife;
      varying float vAge;
      varying float vKind;
      varying float vLife;
      void main() {
        vAge = aAge;
        vKind = aKind;
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = aKind < 0.5 ? 10.0 : aKind < 1.5 ? 16.0 : 3.0;
        gl_PointSize = aLife <= 0.0 ? 0.0 : px;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAge;
      varying float vKind;
      varying float vLife;
      void main() {
        if (vLife <= 0.0 || vAge >= vLife) discard;
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float alpha = 0.0;
        if (vKind < 0.5) {
          float rise = smoothstep(0.0, 0.03, vAge);
          alpha = rise * exp(-max(vAge - 0.03, 0.0) / 0.07);
        } else if (vKind < 1.5) {
          if (vAge < 0.04) alpha = 1.0;
          else if (vAge < 0.08) alpha = 0.3;
          else if (vAge < 0.12) alpha = 1.0;
          else alpha = exp(-(vAge - 0.12) / 0.18);
        } else {
          alpha = 1.0 - vAge / vLife;
        }
        vec3 halo = vec3(0.749, 0.890, 1.0);
        vec3 core = vec3(1.0);
        vec3 color = mix(halo, core, smoothstep(0.5, 0.05, r));
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
  });
  const flashes = new Points(flashGeo, flashMat);
  flashes.frustumCulled = false;
  flashes.renderOrder = 4;
  scene.add(flashes);
  let flashCursor = 0;
  const flashRng = mulberry32(0xa11);
  const scratch = new Vector3();
  const tangent = new Vector3();

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
  let ranges: { start: number; count: number; h: number }[] = [];
  const killRate = new Map<number, number>();
  const collRate = new Map<number, number>();
  let dayScale = 7;
  let simDays = 0;
  let lost = 0;
  let saturated = false;
  const clock = el('div', 'sim-clock');
  const clockTime = el('div', '', 'Simulated time: 0 yr 0 d');
  const clockLost = el('div', '', 'Satellites lost (simulated): 0');
  const clockNote = el('div', 'caption', 'Flashes are illustrative; their rate follows the model.');
  const clockSat = el('div', 'caption', 'Losses faster than can be drawn');
  clockSat.hidden = true;
  const scales = el('div', 'chip-grid');
  for (const [label, days] of [['1 day', 1], ['1 week', 7], ['1 month', 365.25 / 12]] as const) {
    const button = el('button', 'btn', `1 s = ${label}`);
    button.type = 'button';
    if (days === 7) button.classList.add('accent');
    button.addEventListener('click', () => {
      dayScale = days;
      for (const node of scales.querySelectorAll('button')) node.classList.remove('accent');
      button.classList.add('accent');
    });
    scales.append(button);
  }
  clock.append(clockTime, scales, clockLost, clockNote, clockSat);
  const rayOrigin = new Vector3();
  const rayDir = new Vector3();

  function budget(): number {
    return Math.max(200, Math.floor((mobile ? 2500 : 6000) / 2 ** quality));
  }
  function debrisBudget(): number {
    return Math.max(80, Math.floor((mobile ? 600 : 1500) / 2 ** quality));
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
      satGeo.setDrawRange(0, 0);
      instances = 0;
      return;
    }
    for (const row of rows) {
      const style = r0Style(row.R0);
      const mat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcColorFactor,
        uniforms: {
          uColor: { value: new Color().setRGB(style.rgb[0], style.rgb[1], style.rgb[2]) },
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
          uniform float uPulse;
          void main() {
            float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 5.0);
            float alpha = min(0.35, fres * uPulse);
            gl_FragColor = vec4(uColor * alpha, alpha);
          }
        `,
      });
      const mesh = new Mesh(shellGeo, mat);
      mesh.renderOrder = 2;
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
    (satGeo.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
  }

  function buildSats(rows: ShellRow[]): void {
    const totalN = rows.reduce((sum, row) => sum + Math.max(0, row.N), 0);
    const cap = Math.min(MAX_SATS, budget(), Math.round(totalN));
    const raw = rows.map((row) => (totalN > 0 ? (cap * row.N) / totalN : 0));
    const counts = raw.map((value) => Math.floor(value));
    let leftover = cap - counts.reduce((sum, value) => sum + value, 0);
    const order = raw
      .map((value, index) => ({ index, frac: value - Math.floor(value) }))
      .sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < leftover; i++) counts[order[i % order.length]!.index] += 1;
    const rng = mulberry32(0x6e55);
    const incs = [53, 70, 97.6, 30].map((d) => (d * Math.PI) / 180);
    const weightsInc = [0.35, 0.15, 0.35, 0.15];
    let cursor = 0;
    ranges = [];
    rows.forEach((row, index) => {
      const count = Math.min(MAX_SATS - cursor, counts[index] ?? 0);
      shells[index].mesh.userData.count = count;
      ranges.push({ start: cursor, count, h: row.h });
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
    satGeo.setDrawRange(0, cursor);
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

  function dotPx(area: number): number {
    return Math.min(6, Math.max(1.4, 1.6 + 1.2 * Math.log10(Math.max(area, 1) / 100)));
  }

  function spawnFlash(x: number, y: number, z: number, kind: number, life: number, vx = 0, vy = 0, vz = 0): void {
    const i = flashCursor % POOL;
    flashCursor += 1;
    flashPos[i * 3] = x;
    flashPos[i * 3 + 1] = y;
    flashPos[i * 3 + 2] = z;
    flashAge[i] = 0;
    flashKind[i] = kind;
    flashLife[i] = life;
    flashVel[i * 3] = vx;
    flashVel[i * 3 + 1] = vy;
    flashVel[i * 3 + 2] = vz;
  }

  function paintClock(): void {
    const years = Math.floor(simDays / 365.25);
    const days = Math.floor(simDays - years * 365.25);
    clockTime.textContent = `Simulated time: ${years} yr ${days} d`;
    clockLost.textContent = `Satellites lost (simulated): ${lost.toLocaleString('en-US')}`;
    clockSat.hidden = !saturated;
  }

  function stepFlashes(dt: number): void {
    const dtYears = (dt * dayScale) / 365.25;
    simDays += dt * dayScale;
    let spawned = 0;
    let stop = false;
    saturated = false;
    for (const range of ranges) {
      if (stop || range.count <= 0) continue;
      const kills = (killRate.get(range.h) ?? 0) * dtYears;
      const colls = (collRate.get(range.h) ?? 0) * dtYears;
      const nKill = poisson(kills, flashRng);
      const nColl = poisson(colls, flashRng);
      lost += nKill + nColl;
      for (let n = 0; n < nKill + nColl; n++) {
        if (spawned >= 40) {
          saturated = true;
          stop = true;
          break;
        }
        const index = range.start + Math.floor(flashRng() * range.count);
        const u = satPhase[index] + satOmega[index] * time;
        orbitPosition(satRadius[index], satIncl[index], satRaan[index], u, scratch);
        const collision = n >= nKill;
        spawnFlash(scratch.x, scratch.y, scratch.z, collision ? 1 : 0, collision ? 0.62 : 0.26);
        if (collision) {
          const speed = 0.015;
          for (let s = 0; s < 8; s++) {
            tangent.set(flashRng() - 0.5, flashRng() - 0.5, flashRng() - 0.5);
            if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
            tangent.cross(scratch).normalize().multiplyScalar(speed * (0.6 + flashRng()));
            spawnFlash(scratch.x, scratch.y, scratch.z, 2, 1.2, tangent.x, tangent.y, tangent.z);
          }
        }
        spawned += 1;
      }
    }
    for (let i = 0; i < POOL; i++) {
      if (flashLife[i] <= 0) continue;
      flashAge[i] += dt;
      if (flashAge[i] >= flashLife[i]) {
        flashLife[i] = 0;
        continue;
      }
      if (flashKind[i] > 1.5) {
        flashPos[i * 3] += flashVel[i * 3] * dt;
        flashPos[i * 3 + 1] += flashVel[i * 3 + 1] * dt;
        flashPos[i * 3 + 2] += flashVel[i * 3 + 2] * dt;
      }
    }
    flashGeo.getAttribute('position').needsUpdate = true;
    flashGeo.getAttribute('aAge').needsUpdate = true;
    flashGeo.getAttribute('aKind').needsUpdate = true;
    flashGeo.getAttribute('aLife').needsUpdate = true;
    paintClock();
  }

  function apply(rows: ShellRow[], dynamics?: { area: number; kills: number[]; coll: number[] }): number {
    if (dynamics) {
      killRate.clear();
      collRate.clear();
      H_C.forEach((h, index) => {
        killRate.set(h, dynamics.kills[index] ?? 0);
        collRate.set(h, dynamics.coll[index] ?? 0);
      });
      satMat.uniforms.uPointSize.value = dotPx(dynamics.area);
    }
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
    canvas.parentElement?.append(clock);
  }
  function unbind(): void {
    const canvas = dom();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', hideTip);
    hideTip();
    clock.remove();
  }

  function view(): TabView {
    return {
      scene: scene as ThreeScene,
      camera,
      controls,
      label: 'Kessler',
      update(dt) {
        const play = !paused;
        if (!play) return false;
        time += dt;
        satMat.uniforms.uTime.value = time;
        debrisMat.uniforms.uTime.value = time;
        const pulse = 1 + 0.15 * Math.sin(Math.PI * time);
        let worst: (typeof shells)[number] | null = null;
        for (const shell of shells) if (!worst || shell.row.R0 > worst.row.R0) worst = shell;
        for (const shell of shells) shell.mat.uniforms.uPulse.value = shell === worst ? pulse : 1;
        stepFlashes(dt);
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
    resetSim() {
      simDays = 0;
      lost = 0;
      saturated = false;
      flashLife.fill(0);
      paintClock();
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

function poisson(mean: number, rng: () => number): number {
  if (!(mean > 0)) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > limit && k < 80);
  return k - 1;
}
