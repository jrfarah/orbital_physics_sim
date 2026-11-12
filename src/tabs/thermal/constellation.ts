import { CircleGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';

/**
 * One draw for the far field. The axial spiral matches src/tabs/thermal/hex.ts.
 * A cell is a satellite glyph until it is smaller than a few pixels, then its mean color.
 */
export const constellationMaterial = new ShaderMaterial({
  uniforms: {
    uN: { value: 1 },
    uSpacing: { value: 1 },
    uRSat: { value: 1 },
    uRRad: { value: 0.4 },
    uEmber: { value: new Vector3(0.4, 0.05, 0.02) },
    uBlue: { value: null },
    uDitherGate: { value: 1 },
    uDitherMode: { value: -1 },
    uHole: { value: -1 },
  },
  depthWrite: false,
  toneMapped: true,
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uN;
    uniform float uSpacing;
    uniform float uRSat;
    uniform float uRRad;
    uniform vec3 uEmber;
    uniform sampler2D uBlue;
    uniform float uDitherGate;
    uniform float uDitherMode;
    uniform float uHole;
    varying vec3 vWorld;

    float ringOf(float index) {
      if (index <= 0.0) return 0.0;
      float k = ceil((3.0 + sqrt(max(12.0 * index - 3.0, 0.0))) / 6.0);
      if (3.0 * k * (k - 1.0) + 1.0 > index + 0.001) k -= 1.0;
      return k;
    }

    float indexFromAxial(float q, float r) {
      if (abs(q) + abs(r) < 0.001) return 0.0;
      float k = max(abs(q), max(abs(r), abs(q + r)));
      float side = 5.0;
      float step = r;
      if (abs(r - k) < 0.001 && q >= -k - 0.001 && q < -0.001) {
        side = 0.0;
        step = q + k;
      } else if (abs(q + r - k) < 0.001 && q >= -0.001 && r > 0.001) {
        side = 1.0;
        step = q;
      } else if (abs(q - k) < 0.001 && r <= 0.001 && r > -k + 0.001) {
        side = 2.0;
        step = -r;
      } else if (abs(r + k) < 0.001 && q > 0.001 && q <= k + 0.001) {
        side = 3.0;
        step = k - q;
      } else if (abs(q + r + k) < 0.001 && q <= 0.001 && q > -k + 0.001 && r < -0.001) {
        side = 4.0;
        step = -q;
      }
      return 3.0 * k * (k - 1.0) + 1.0 + side * k + step;
    }

    vec2 axialRound(vec2 qr) {
      float s = -qr.x - qr.y;
      float rq = round(qr.x);
      float rr = round(qr.y);
      float rs = round(s);
      float dq = abs(rq - qr.x);
      float dr = abs(rr - qr.y);
      float ds = abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr - rs;
      else if (dr > ds) rr = -rq - rs;
      return vec2(rq, rr);
    }

    vec2 axialToWorld(vec2 qr) {
      return vec2(uSpacing * (qr.x + qr.y * 0.5), uSpacing * (0.8660254 * qr.y));
    }

    float satHash(vec2 qr) {
      return fract(sin(dot(qr, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec3 solarMean() {
      vec3 bytes = (vec3(13.5, 32.0, 72.0) * 0.796 + vec3(201.0, 211.0, 223.0) * 0.088 + vec3(138.0, 150.0, 166.0) * 0.116) / 255.0;
      return pow(max(bytes, vec3(0.0)), vec3(2.2));
    }

    void main() {
      vec2 qr = vec2(vWorld.x / uSpacing, vWorld.z / (uSpacing * 0.8660254));
      qr.x -= qr.y * 0.5;
      vec2 cell = axialRound(qr);
      float index = indexFromAxial(cell.x, cell.y);
      float edge = clamp(uN - index, 0.0, 1.0);
      if (edge <= 0.0) discard;
      bool hole = uHole >= 0.0 && index < uHole;
      if (uDitherMode > -0.5 && (uHole < 0.0 || hole)) {
        float bn = texture2D(uBlue, gl_FragCoord.xy / 64.0).r;
        if (uDitherMode > 0.5) { if (bn > uDitherGate) discard; }
        else if (bn <= uDitherGate) discard;
      } else if (hole) {
        discard;
      }
      vec2 center = axialToWorld(cell);
      vec2 local = vec2(vWorld.x, vWorld.z) - center;
      float dist = length(local);
      float noise = satHash(cell);
      vec3 ember = uEmber * (1.15 + 0.45 * noise);
      vec3 solar = solarMean() * 2.55;
      float ang = atan(local.y, local.x);
      float seam = smoothstep(0.02, 0.08, abs(fract(ang * 1.909859 - 0.5) - 0.5));
      solar *= 0.9 + 0.1 * seam;
      vec3 glyph = dist < uRRad ? ember : solar;
      if (dist > uRSat) glyph = vec3(0.0);
      float cellPx = 1.0 / max(length(fwidth(qr)), 1e-4);
      float detail = smoothstep(1.5, 6.0, cellPx);
      float cellArea = 0.8660254 * uSpacing * uSpacing;
      float radFrac = 3.14159265 * uRRad * uRRad / cellArea;
      float solFrac = 3.14159265 * max(uRSat * uRSat - uRRad * uRRad, 0.0) / cellArea;
      vec3 mean = (ember * radFrac + solar * solFrac) * 0.85;
      vec3 color = mix(mean, glyph, detail);
      gl_FragColor = vec4(color * edge, 1.0);
    }
  `,
});

export function createConstellationMesh(): Mesh {
  const mesh = new Mesh(new CircleGeometry(1, 96), constellationMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.frustumCulled = false;
  mesh.name = 'constellation';
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}
