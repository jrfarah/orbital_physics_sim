import {
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { getEmberNoise, sampleNoise } from './noise';

const STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0, rgb: [18, 3, 2] },
  { t: 0.2, rgb: [58, 9, 4] },
  { t: 0.45, rgb: [122, 20, 7] },
  { t: 0.7, rgb: [184, 41, 12] },
  { t: 0.9, rgb: [226, 68, 26] },
  { t: 1, rgb: [226, 68, 26] },
];

function srgbToLinearByte(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(c: number): number {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, x)) * 255);
}

/** Piecewise-linear ember ramp in linear RGB, 0..1. */
export function emberLinear(k: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, k));
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1].t) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  return [0, 1, 2].map((ch) => {
    const la = srgbToLinearByte(a.rgb[ch]);
    const lb = srgbToLinearByte(b.rgb[ch]);
    return la + (lb - la) * u;
  }) as [number, number, number];
}

export function coverageK(heat01: number, n: number, uvx: number, uvy: number): number {
  const edge = 1 - smoothstep(0, 0.5, Math.min(Math.min(uvx, 1 - uvx), Math.min(uvy, 1 - uvy)));
  const field = 0.65 * n + 0.35 * (1 - edge);
  if (heat01 < 0.02) return 0;
  const threshold = 1 - heat01;
  return smoothstep(threshold - 0.05, threshold + 0.05, 1 - field);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Narkowicz ACES fit so the Canvas2D twin sits nearer the tone-mapped 3D view. */
function aces(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

const METAL: [number, number, number] = [61, 66, 74].map(srgbToLinearByte) as [number, number, number];
const WARM: [number, number, number] = [122, 23, 10].map(srgbToLinearByte) as [number, number, number];

export function facePixel(heat01: number, uvx: number, uvy: number): [number, number, number] {
  const n = sampleNoise(uvx, uvy);
  const streak = sampleNoise(uvx * 8, uvy);
  const k = coverageK(heat01, n, uvx, uvy);
  const ember = emberLinear(k);
  const shade = 0.22 + 0.08 * (1 - streak);
  const tint = heat01 * 0.06;
  const rgb = [0, 1, 2].map((ch) => {
    const metal = METAL[ch] * shade;
    const warmed = metal + (WARM[ch] - metal) * tint;
    const lit = warmed + ember[ch] * (0.15 + 1.6 * k);
    return linearToSrgbByte(aces(lit));
  }) as [number, number, number];
  return rgb;
}

/** Full-coverage legend color at a given heat01, sRGB bytes. */
export function legendColor(heat01: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, heat01));
  const ember = emberLinear(k);
  const tint = k * 0.06;
  return [0, 1, 2].map((ch) => {
    const metal = METAL[ch] * 0.28;
    const warmed = metal + (WARM[ch] - metal) * tint;
    const lit = warmed + ember[ch] * (0.15 + 1.6 * k);
    return linearToSrgbByte(aces(lit));
  }) as [number, number, number];
}

let white: DataTexture | null = null;
function whiteMap(): DataTexture {
  if (white) return white;
  const data = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
  white = new DataTexture(data, 2, 2, RGBAFormat, UnsignedByteType);
  white.colorSpace = SRGBColorSpace;
  white.magFilter = LinearFilter;
  white.minFilter = LinearFilter;
  white.needsUpdate = true;
  white.colorSpace = NoColorSpace;
  // DECISION: a constant white map only exists so MeshStandardMaterial emits UVs.
  // NoColorSpace keeps it from tinting the albedo.
  return white;
}

/** Shared by every ember material. The bloom pass sets this to 1. */
export const bloomOnly = { value: 0 };

const HEAT_GLSL = /* glsl */ `
vec3 srgbToLin(vec3 c){
  return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 emberRamp(float k){
  vec3 c0 = srgbToLin(vec3(18.0, 3.0, 2.0)/255.0);
  vec3 c1 = srgbToLin(vec3(58.0, 9.0, 4.0)/255.0);
  vec3 c2 = srgbToLin(vec3(122.0, 20.0, 7.0)/255.0);
  vec3 c3 = srgbToLin(vec3(184.0, 41.0, 12.0)/255.0);
  vec3 c4 = srgbToLin(vec3(226.0, 68.0, 26.0)/255.0);
  if (k < 0.20) return mix(c0, c1, clamp(k / 0.20, 0.0, 1.0));
  if (k < 0.45) return mix(c1, c2, clamp((k - 0.20) / 0.25, 0.0, 1.0));
  if (k < 0.70) return mix(c2, c3, clamp((k - 0.45) / 0.25, 0.0, 1.0));
  if (k < 0.90) return mix(c3, c4, clamp((k - 0.70) / 0.20, 0.0, 1.0));
  return c4;
}
`;

export interface HeatMaterial extends MeshStandardMaterial {
  userData: { heat: { value: number }; time: { value: number }; side: { value: number } };
}

const SOLAR_VERT = /* glsl */ `
attribute float aScale;
attribute float aMix;
varying float vMix;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vUv = uv;
  vMix = aMix;
  vec3 p = position * aScale;
  #ifdef USE_INSTANCING
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  #else
    vec4 world = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
  #endif
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SOLAR_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uLightDir;
varying float vMix;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;

vec3 srgb(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

void main() {
  float alpha = uOpacity * vMix;
  if (alpha < 0.01) discard;

  vec3 alum = srgb(vec3(138.0, 150.0, 166.0) / 255.0);
  vec3 alumEdge = srgb(vec3(176.0, 186.0, 198.0) / 255.0);
  vec3 back = srgb(vec3(201.0, 211.0, 223.0) / 255.0);
  vec3 c0 = srgb(vec3(10.0, 23.0, 54.0) / 255.0);
  vec3 c1 = srgb(vec3(17.0, 41.0, 90.0) / 255.0);
  vec3 silver = srgb(vec3(163.0, 174.0, 189.0) / 255.0);

  vec2 uv = vUv;
  vec2 fw = fwidth(uv);
  float texel = max(fw.x, fw.y);
  float tilePx = 1.0 / max(texel, 1e-5);
  float cellPx = tilePx * (0.94 / 8.0);

  vec2 tileEdge = min(uv, 1.0 - uv);
  float frameDist = min(tileEdge.x, tileEdge.y);
  float frameAa = min(texel, 0.008);
  float frameCov = 1.0 - smoothstep(0.03 - frameAa, 0.03 + frameAa, frameDist);
  frameCov *= smoothstep(1.0, 2.5, 0.03 * tilePx);
  vec3 frameCol = mix(alumEdge, alum, clamp(frameDist / 0.03, 0.0, 1.0));

  vec2 p = (uv - 0.03) / 0.94;
  vec2 cellUv = p * 8.0;
  vec2 cellId = floor(cellUv);
  vec2 f = fract(cellUv);
  vec2 fwCell = fwidth(cellUv);
  float gapDist = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float gapAa = min(max(fwCell.x, fwCell.y), 0.008);
  float gapN = max(0.02, min(0.10, 1.15 / max(cellPx, 1.0)));
  float gapCov = 1.0 - smoothstep(gapN - gapAa, gapN + gapAa, gapDist);
  float corner = min(
    min(f.x + f.y, (1.0 - f.x) + f.y),
    min(f.x + (1.0 - f.y), (1.0 - f.x) + (1.0 - f.y))
  );
  float cutAa = min(max(fwCell.x, fwCell.y), 0.03);
  float cutCov = 1.0 - smoothstep(0.12 - cutAa, 0.12 + cutAa, corner);
  float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
  float gapVis = smoothstep(8.0, 14.0, cellPx);
  float cutVis = smoothstep(10.0, 18.0, cellPx);
  float sheet = max(gapCov * gapVis, cutCov * cutVis) * inside * (1.0 - frameCov);

  float hash = fract(sin(dot(cellId + 1.0, vec2(127.1, 311.7))) * 43758.5453);
  vec3 cell = mix(c0, c1, hash) * mix(0.92, 1.05, f.y);

  float fingerFade = smoothstep(8.0, 16.0, cellPx) * smoothstep(0.6, 1.4, cellPx * 0.008);
  float busFade = smoothstep(3.0, 7.0, cellPx) * smoothstep(0.7, 1.6, cellPx * 0.015);
  float fy = abs(fract(f.y * 10.0) - 0.5);
  float fingerAa = min(fwidth(f.y * 10.0), 0.02);
  float finger = 1.0 - smoothstep(0.04, 0.04 + fingerAa, fy);
  float busAa = min(fwCell.x, 0.004);
  float bus = 0.0;
  bus = max(bus, 1.0 - smoothstep(0.0075, 0.0075 + busAa, abs(f.x - 0.25)));
  bus = max(bus, 1.0 - smoothstep(0.0075, 0.0075 + busAa, abs(f.x - 0.50)));
  bus = max(bus, 1.0 - smoothstep(0.0075, 0.0075 + busAa, abs(f.x - 0.75)));
  float line = inside * (1.0 - frameCov) * (1.0 - sheet);
  cell = mix(cell, silver, finger * 0.06 * fingerFade * line);
  cell = mix(cell, silver, bus * busFade * line);

  vec3 col = mix(cell, back, sheet);
  col = mix(col, frameCol, frameCov);

  // Area weights: cell body 0.796, backsheet 0.088, frame 0.116.
  // Mixed in sRGB so the bright frame does not erase the cell color.
  vec3 average = srgb((
    vec3(13.5, 32.0, 72.0) * 0.796 +
    vec3(201.0, 211.0, 223.0) * 0.088 +
    vec3(138.0, 150.0, 166.0) * 0.116
  ) / 255.0);
  float detail = smoothstep(2.0, 4.0, cellPx);
  col = mix(average, col, detail);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 40.0) * 0.3 * ndl;
  vec3 color = col * (0.38 + 0.62 * ndl) + vec3(spec);
  #ifdef TONE_MAPPING
    color = toneMapping(color);
  #else
    color *= 1.15;
    color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  #endif
  gl_FragColor = linearToOutputTexel(vec4(color, alpha));
}
`;

/** Procedural monocrystalline panel. No textures. */
export function createSolarMaterial(): ShaderMaterial {
  const uOpacity = { value: 1 };
  const mat = new ShaderMaterial({
    uniforms: {
      uOpacity,
      uLightDir: { value: new Vector3(0.4, 1, 0.7).normalize() },
    },
    vertexShader: SOLAR_VERT,
    fragmentShader: SOLAR_FRAG,
    transparent: true,
    depthWrite: false,
  });
  mat.onBeforeRender = () => {
    uOpacity.value = mat.opacity;
  };
  return mat;
}

export function createEmberMaterial(
  options: {
    instanced?: boolean;
    heat01?: number;
    noise?: { offset: [number, number]; rotation: number; scale?: number };
  } = {},
): HeatMaterial {
  const instanced = options.instanced === true;
  const heat01 = options.heat01 ?? 0;
  const noise = options.noise ?? { offset: [0, 0] as [number, number], rotation: 0 };
  const heat = { value: heat01 };
  const noiseOffset = { value: new Vector2(noise.offset[0], noise.offset[1]) };
  const noiseRotation = { value: noise.rotation };
  const noiseScale = { value: noise.scale ?? 1 };
  const mat = new MeshStandardMaterial({
    color: 0x3d424a,
    metalness: 0.85,
    roughness: 0.38,
    map: whiteMap(),
    envMap: null,
    envMapIntensity: 0,
  }) as HeatMaterial;
  mat.userData.heat = heat;
  const time = { value: 0 };
  const side = { value: 1 };
  mat.userData.time = time;
  mat.userData.side = side;
  mat.customProgramCacheKey = () => (instanced ? 'ember-instanced-v1' : 'heat-face-v6');
  if (instanced) {
    mat.transparent = true;
    mat.depthWrite = false;
  }
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uHeat = heat;
    shader.uniforms.uNoise = { value: getEmberNoise() };
    shader.uniforms.uNoiseOffset = noiseOffset;
    shader.uniforms.uNoiseRotation = noiseRotation;
    shader.uniforms.uNoiseScale = noiseScale;
    shader.uniforms.uBloomOnly = bloomOnly;
    shader.uniforms.uTime = time;
    shader.uniforms.uSide = side;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${
          instanced
            ? `attribute float aScale;
attribute float aMix;
varying float vMix;
varying float vSeed;`
            : ''
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        instanced
          ? `vec3 transformed = vec3(position) * aScale;
vMix = aMix;
vSeed = fract(sin(float(gl_InstanceID + 1) * 12.9898) * 43758.5453);`
          : '#include <begin_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHeat;
uniform sampler2D uNoise;
uniform vec2 uNoiseOffset;
uniform float uNoiseRotation;
uniform float uNoiseScale;
uniform float uBloomOnly;
vec3 emberOut;
${instanced ? 'varying float vMix;\nvarying float vSeed;' : ''}
${HEAT_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 mapUv = vMapUv;
float rot = uNoiseRotation;
vec2 off = uNoiseOffset;
float scl = uNoiseScale;
${
  instanced
    ? `float seed = vSeed;
rot = fract(seed * 17.13) * 6.2831853;
off = vec2(fract(seed * 3.17), fract(seed * 9.71));
scl = 0.7 + 0.7 * fract(seed * 5.31);`
    : ''
}
float cs = cos(rot);
float sn = sin(rot);
vec2 heatUv = mat2(cs, sn, -sn, cs) * (mapUv * scl) + off;
float nR = texture2D(uNoise, heatUv).r;
float nG = texture2D(uNoise, heatUv * 2.0).g;
float border = min(min(mapUv.x, 1.0 - mapUv.x), min(mapUv.y, 1.0 - mapUv.y));
float edge = 1.0 - smoothstep(0.0, 0.5, border);
float field = 0.6 * nR + 0.25 * nG + 0.15 * (1.0 - edge);
float cover = smoothstep(1.0 - uHeat * 1.1 - 0.25, 1.0 - uHeat * 1.1 + 0.25, field);
float inten = cover * uHeat * (0.75 + 0.5 * nG);
vec3 ember = emberRamp(inten);
diffuseColor.rgb *= (1.0 - 0.6 * cover);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float streak = texture2D(uNoise, heatUv * vec2(8.0, 1.0)).r;
roughnessFactor *= mix(0.82, 1.18, streak);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
emberOut = ember * (0.2 + 3.0 * pow(max(inten, 0.0), 1.4));
${instanced ? 'emberOut *= 1.0 - vMix;' : ''}
totalEmissiveRadiance += emberOut;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (uBloomOnly > 0.5) gl_FragColor = vec4(emberOut, 1.0);
${instanced ? 'else gl_FragColor.a *= 1.0 - vMix;' : ''}`,
      );
  };
  return mat;
}

export function createHeatMaterial(
  heat01 = 0,
  tiles = false,
  noise: { offset: [number, number]; rotation: number; scale?: number } = { offset: [0, 0], rotation: 0 },
): HeatMaterial {
  return createEmberMaterial({ instanced: tiles, heat01, noise });
}

export function setHeat(mat: HeatMaterial, heat01: number): void {
  mat.userData.heat.value = heat01;
}
