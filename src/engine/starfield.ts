import { BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

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

export function createStarfield(mobile: boolean): Points {
  const n = mobile ? 800 : 1500;
  const rng = mulberry32(0x51a5);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    const v = rng();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 80;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const c = 0.72 + rng() * 0.28;
    const warm = rng();
    col[i * 3] = c;
    col[i * 3 + 1] = c * (0.94 + 0.06 * warm);
    col[i * 3 + 2] = c * (0.9 + 0.1 * (1 - warm));
    size[i] = 0.5 + rng();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new BufferAttribute(col, 3));
  geo.setAttribute('aSize', new BufferAttribute(size, 1));
  const mat = new ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function createSunSprite(): Points {
  // A soft additive point, far along +X. Decorative only.
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([18, 0, 0]), 3));
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: 2,
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 64.0;
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        float a = smoothstep(0.5, 0.0, r);
        vec3 col = mix(vec3(1.0, 0.72, 0.35), vec3(1.0, 0.95, 0.8), smoothstep(0.28, 0.0, r));
        gl_FragColor = vec4(col, a * 0.9);
      }
    `,
  });
  const sun = new Points(geo, mat);
  sun.frustumCulled = false;
  return sun;
}
