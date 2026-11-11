import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { createHeatMaterial, setHeat } from '../../engine/heatMaterial';
import { clearUserOrbit, createControls, makeCamera, reducedMotion, requestRender, userHasOrbited, type TabView } from '../../engine/renderer';
import { REFERENCE_AREAS } from '../../physics/references';
import { fmtArea } from '../../ui/format';

const T_COLD = 300;
const T_HOT = 650;
const ELEV = (35 * Math.PI) / 180;

const SHAPES: Record<string, { w: number; h: number; name: string }> = {
  football: { w: 109.7, h: 48.8, name: 'Football field' },
  centralpark: { w: 4000, h: 850, name: 'Central Park' },
  manhattan: { w: 21600, h: 2736, name: 'Manhattan' },
  sf: { w: 11018, h: 11018, name: 'San Francisco' },
  ri: { w: 51750, h: 51750, name: 'Rhode Island' },
  ct: { w: 111990, h: 111990, name: 'Connecticut' },
};

interface Radii {
  rad: number;
  outer: number;
  bare: number;
}

export interface ThermalLayout {
  aRad: number;
  aSol: number;
  aTot: number;
  aBare: number;
  tHot: number;
  pump: boolean;
}

export function createThermalScene(overlay: HTMLElement) {
  const scene = new Scene();
  const sun = new DirectionalLight(0xffffff, 1.35);
  sun.position.set(0.4, 1, 0.7);
  scene.add(sun, new AmbientLight(0xffffff, 0.45));

  const ground = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x070b12 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const solarMat = new ShaderMaterial({
    toneMapped: false,
    uniforms: { uInner: { value: 0 }, uColor: { value: new Color('#16306e') } },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uInner;
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main() {
        float r = length(vWorld.xz);
        if (r < uInner) discard;
        vec2 fw = max(fwidth(vWorld.xz), vec2(0.0001));
        float fade = 1.0 - smoothstep(0.35, 1.1, max(fw.x, fw.y));
        vec2 g = abs(fract(vWorld.xz - 0.5) - 0.5) / fw;
        float line = (1.0 - min(min(g.x, g.y), 1.0)) * fade;
        vec3 col = mix(uColor, min(uColor * 1.85, vec3(1.0)), line * 0.6);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const solar = new Mesh(new CircleGeometry(1, 96), solarMat);
  solar.rotation.x = -Math.PI / 2;
  solar.position.y = 0.02;
  scene.add(solar);

  const heatMat = createHeatMaterial(0, false);
  heatMat.polygonOffset = true;
  heatMat.polygonOffsetFactor = -2;
  heatMat.polygonOffsetUnits = -2;
  const radiator = new Mesh(new CircleGeometry(1, 72), heatMat);
  radiator.rotation.x = -Math.PI / 2;
  radiator.position.y = 0.03;
  scene.add(radiator);

  const dot = new Mesh(new CircleGeometry(0.5, 20), new MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.9, depthWrite: false }));
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.08;
  scene.add(dot);

  const dashGeo = circleGeo();
  const dashMat = new LineDashedMaterial({ color: 0x9aa9bb, dashSize: 1, gapSize: 0.6, transparent: true });
  const dash = new LineLoop(dashGeo, dashMat);
  scene.add(dash);

  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.setAttribute('class', 'leaders area-leaders');
  overlay.append(leaders);
  const tag = (text: string) => {
    const node = document.createElement('div');
    node.className = 'world-tag';
    node.textContent = text;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    leaders.append(line);
    overlay.append(node);
    return { node, line };
  };
  const computeTag = tag('Compute');
  const radTag = tag('Radiator');
  const solTag = tag('Solar');
  const pumpTag = tag('without heat pump');

  const footprints = REFERENCE_AREAS.flatMap((ref) => {
    const shape = SHAPES[ref.id];
    if (!shape) return [];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(24), 3));
    const mat = new LineDashedMaterial({ color: 0xc5ccd6, dashSize: 1, gapSize: 0.7, transparent: true, opacity: 0 });
    const line = new LineSegments(geo, mat);
    line.visible = false;
    scene.add(line);
    const label = tag(shape.name);
    label.node.style.opacity = '0';
    return [{ id: ref.id, name: shape.name, area: ref.m2, w: shape.w, h: shape.h, geo, mat, line, label, opacity: 0, target: 0, cx: 0, cz: 0 }];
  });

  const camera = makeCamera();
  camera.near = 0.05;
  camera.far = 1e7;
  camera.updateProjectionMatrix();
  let controls = createControls(camera, { min: 1, max: 1e7 });
  let shown: Radii = { rad: 13, outer: 13, bare: 13 };
  let anim: { t0: number; from: Radii; to: Radii } | null = null;
  let dist = 40;
  let distAnim: { t0: number; from: number; to: number } | null = null;
  let pumpOn = false;
  const scratch = new Vector3();

  applyRadii(shown);
  applyPose(dist);

  function layout(next: ThermalLayout): void {
    const to = {
      rad: discRadius(next.aRad),
      outer: discRadius(next.aRad + next.aSol),
      bare: discRadius(next.aBare),
    };
    pumpOn = next.pump;
    radTag.node.textContent = `Radiator · ${fmtArea(next.aRad)}`;
    solTag.node.textContent = `Solar · ${fmtArea(next.aSol)}`;
    const heat = Math.min(1, Math.max(0, (next.tHot - T_COLD) / (T_HOT - T_COLD)));
    setHeat(heatMat, heat);
    placeFootprints(to.outer, next.aTot);
    if (!anim && reducedMotion()) shown = to;
    anim = { t0: performance.now(), from: { ...shown }, to };
    if (!reducedMotion()) {
      /* radii catch up in update() */
    } else {
      shown = to;
      anim = null;
      applyRadii(shown);
    }
    maybeFrame();
    requestRender();
  }

  function placeFootprints(outer: number, area: number): void {
    const lo = area / 30;
    const hi = area * 30;
    const ranked = footprints
      .filter((fp) => fp.area >= lo && fp.area <= hi && area > 0)
      .sort((a, b) => Math.abs(Math.log(a.area / area)) - Math.abs(Math.log(b.area / area)))
      .slice(0, 3);
    const chosen = new Set(ranked.map((fp) => fp.id));
    let cursor = outer * 1.35;
    const gap = Math.max(outer * 0.12, 4);
    for (const fp of footprints) {
      fp.target = chosen.has(fp.id) ? 1 : 0;
      if (!chosen.has(fp.id)) continue;
      fp.cx = cursor + fp.w / 2;
      fp.cz = 0;
      cursor += fp.w + gap;
      writeRect(fp.geo, fp.cx, fp.cz, fp.w, fp.h);
      const dash = Math.max(fp.w, fp.h) * 0.035;
      fp.mat.dashSize = dash;
      fp.mat.gapSize = dash * 0.65;
      fp.line.computeLineDistances();
    }
  }

  function maybeFrame(): void {
    if (userHasOrbited(controls)) return;
    const next = desiredDist(anim?.to.outer ?? shown.outer);
    const goal = distAnim?.to ?? dist;
    if (!(next > 0) || Math.abs(Math.log(next / goal)) < 0.08) return;
    if (reducedMotion()) {
      dist = next;
      distAnim = null;
      applyPose(dist);
      return;
    }
    distAnim = { t0: performance.now(), from: dist, to: next };
  }

  function desiredDist(outer: number): number {
    const aspect = Math.max(0.3, camera.aspect || 1);
    const fov = (camera.fov * Math.PI) / 180;
    const span = 2 * Math.tan(fov / 2) * aspect;
    return (2 * Math.max(outer, 1)) / (0.45 * span);
  }

  function applyPose(distance: number): void {
    dist = distance;
    camera.position.set(0, distance * Math.sin(ELEV), distance * Math.cos(ELEV));
    camera.near = Math.max(0.02, distance / 400);
    camera.far = distance * 80;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.minDistance = Math.max(0.4, distance * 0.12);
    controls.maxDistance = distance * 40;
    controls.update();
    const reach = distance * 30;
    ground.scale.set(reach, reach, 1);
  }

  function applyRadii(radii: Radii): void {
    shown = radii;
    const outer = Math.max(radii.outer, 0.05);
    const rad = Math.max(radii.rad, 0.02);
    solar.scale.setScalar(outer);
    solarMat.uniforms.uInner!.value = Math.min(rad, outer * 0.999);
    radiator.scale.setScalar(rad);
    writeCircle(dashGeo, Math.max(radii.bare, 0.05), 0.1);
    dash.computeLineDistances();
    dashMat.dashSize = Math.max(radii.bare * 0.04, 0.4);
    dashMat.gapSize = dashMat.dashSize * 0.65;
    dash.visible = pumpOn;
    const host = overlay.clientWidth || 800;
    const fov = (camera.fov * Math.PI) / 180;
    const viewW = 2 * dist * Math.tan(fov / 2) * Math.max(camera.aspect, 0.3);
    dot.scale.setScalar(Math.max((14 / host) * viewW, 0.2));
  }

  function view(): TabView {
    return {
      scene,
      camera,
      controls,
      update(dt) {
        let live = false;
        if (anim) {
          const t = Math.min(1, (performance.now() - anim.t0) / 250);
          const e = 1 - (1 - t) ** 3;
          applyRadii(lerpRadii(anim.from, anim.to, e));
          if (t >= 1) anim = null;
          live = true;
        }
        if (distAnim) {
          const t = Math.min(1, (performance.now() - distAnim.t0) / 1200);
          const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
          const logD = Math.log(distAnim.from) + (Math.log(distAnim.to) - Math.log(distAnim.from)) * e;
          applyPose(Math.exp(logD));
          if (t >= 1) distAnim = null;
          live = true;
        }
        const fade = reducedMotion() ? 1 : Math.min(1, dt / 0.3);
        for (const fp of footprints) {
          if (Math.abs(fp.opacity - fp.target) < 0.01) continue;
          fp.opacity += (fp.target - fp.opacity) * fade;
          fp.mat.opacity = fp.opacity;
          fp.line.visible = fp.opacity > 0.03;
          fp.label.node.style.opacity = String(fp.opacity);
          live = true;
        }
        return live;
      },
      resetView() {
        clearUserOrbit(controls);
        const from = Math.max(camera.position.length(), 0.1);
        const to = desiredDist(anim?.to.outer ?? shown.outer);
        if (reducedMotion() || Math.abs(Math.log(to / from)) < 0.02) {
          distAnim = null;
          applyPose(to);
        } else {
          dist = from;
          distAnim = { t0: performance.now(), from, to };
        }
        requestRender();
      },
      onResize() {
        if (userHasOrbited(controls)) return;
        distAnim = null;
        dist = desiredDist(anim?.to.outer ?? shown.outer);
        applyPose(dist);
      },
      syncDom() {
        if (!overlay.isConnected || overlay.clientWidth < 2) return;
        const height = overlay.clientHeight;
        const items: { node: HTMLElement; line: SVGLineElement; x: number; y: number; show: boolean }[] = [];
        const put = (mark: { node: HTMLElement; line: SVGLineElement }, x: number, y: number, z: number, show: boolean) => {
          const p = project(x, y, z);
          items.push({ node: mark.node, line: mark.line, x: p.x, y: p.y, show: show && p.ok });
        };
        put(computeTag, 0, 0.2, 0, true);
        put(radTag, -shown.rad * 0.15, 0.05, shown.rad * 0.75, shown.rad > 0.05);
        put(solTag, shown.outer * 0.15, 0.05, -shown.outer * 0.82, shown.outer > shown.rad + 0.05);
        put(pumpTag, shown.bare, 0.12, 0, pumpOn);
        for (const fp of footprints) put(fp.label, fp.cx - fp.w / 2, 0.1, 0, fp.opacity > 0.05);
        const origin = overlay.getBoundingClientRect();
        const taken: { x: number; y: number; w: number; h: number }[] = [];
        for (const item of items) {
          item.node.hidden = !item.show;
          item.line.style.display = item.show ? '' : 'none';
          if (!item.show) continue;
          let y = Math.min(Math.max(item.y - 18, 8), height - 64);
          item.node.style.left = `${item.x}px`;
          item.node.style.top = `${y}px`;
          for (let guard = 0; guard < 6; guard++) {
            const box = item.node.getBoundingClientRect();
            const local = { x: box.left - origin.left, y: box.top - origin.top, w: box.width, h: box.height };
            const hit = taken.some((prev) => local.x < prev.x + prev.w && local.x + local.w > prev.x && local.y < prev.y + prev.h && local.y + local.h > prev.y);
            if (!hit) {
              taken.push(local);
              item.line.setAttribute('x1', String(item.x));
              item.line.setAttribute('y1', String(item.y));
              item.line.setAttribute('x2', String(local.x + local.w / 2));
              item.line.setAttribute('y2', String(local.y + local.h));
              break;
            }
            y -= 16;
            item.node.style.top = `${y}px`;
          }
        }
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
      const target = controls.target.clone();
      controls = createControls(camera, { min: controls.minDistance, max: controls.maxDistance });
      controls.target.copy(target);
      controls.update();
    },
    detach() {
      controls.dispose();
    },
  };
}

function discRadius(area: number): number {
  if (!Number.isFinite(area) || area <= 0) return 0.05;
  return Math.sqrt(area / Math.PI);
}

function lerpRadii(a: Radii, b: Radii, t: number): Radii {
  return { rad: a.rad + (b.rad - a.rad) * t, outer: a.outer + (b.outer - a.outer) * t, bare: a.bare + (b.bare - a.bare) * t };
}

function circleGeo(): BufferGeometry {
  const count = 128;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  return geo;
}

function writeCircle(geo: BufferGeometry, radius: number, y: number): void {
  const attr = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < attr.count; i++) {
    const t = (i / attr.count) * Math.PI * 2;
    attr.setXYZ(i, Math.cos(t) * radius, y, Math.sin(t) * radius);
  }
  attr.needsUpdate = true;
  geo.computeBoundingSphere();
}

function writeRect(geo: BufferGeometry, cx: number, cz: number, w: number, h: number): void {
  const y = 0.05;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - h / 2;
  const z1 = cz + h / 2;
  const attr = geo.getAttribute('position') as BufferAttribute;
  const pts = [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0];
  for (let i = 0; i < 8; i++) attr.setXYZ(i, pts[i * 3] ?? 0, pts[i * 3 + 1] ?? 0, pts[i * 3 + 2] ?? 0);
  attr.needsUpdate = true;
  geo.computeBoundingSphere();
}
