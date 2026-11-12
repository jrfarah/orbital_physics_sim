import {
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { getEmberNoise, getNoiseTexture, sampleNoise } from './noise';

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

const TILE_GLSL = /* glsl */ `
vec3 srgbToLin(vec3 c){
  return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 emberRamp(float k){
  vec3 c0 = srgbToLin(vec3(42.0, 8.0, 4.0)/255.0);
  vec3 c1 = srgbToLin(vec3(122.0, 23.0, 10.0)/255.0);
  vec3 c2 = srgbToLin(vec3(194.0, 52.0, 26.0)/255.0);
  vec3 c3 = srgbToLin(vec3(255.0, 122.0, 46.0)/255.0);
  if (k < 0.35) return mix(c0, c1, clamp(k/0.35, 0.0, 1.0));
  if (k < 0.65) return mix(c1, c2, clamp((k-0.35)/0.30, 0.0, 1.0));
  return mix(c2, c3, clamp((k-0.65)/0.35, 0.0, 1.0));
}
`;

function createTileMaterial(heat01: number): HeatMaterial {
  const heat = { value: heat01 };
  const mat = new MeshStandardMaterial({
    color: 0x3d424a,
    metalness: 0.85,
    roughness: 0.38,
    map: whiteMap(),
    envMap: null,
    envMapIntensity: 0,
  }) as HeatMaterial;
  mat.userData.heat = heat;
  mat.userData.time = { value: 0 };
  mat.userData.side = { value: 1 };
  mat.customProgramCacheKey = () => 'heat-tiles-v2';
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uHeat = heat;
    shader.uniforms.uNoise = { value: getNoiseTexture() };
    shader.uniforms.uNoiseOffset = { value: new Vector2(0, 0) };
    shader.uniforms.uNoiseRotation = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aScale;\nattribute float aMix;\nvarying float vMix;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) * aScale;\nvMix = aMix;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHeat;
uniform sampler2D uNoise;
uniform vec2 uNoiseOffset;
uniform float uNoiseRotation;
varying float vMix;
${TILE_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 heatUv = vMapUv;
float cs = cos(uNoiseRotation);
float sn = sin(uNoiseRotation);
heatUv = mat2(cs, sn, -sn, cs) * heatUv + uNoiseOffset;
float n = texture2D(uNoise, heatUv).r;
float edge = 1.0 - smoothstep(0.0, 0.5, min(min(heatUv.x, 1.0-heatUv.x), min(heatUv.y, 1.0-heatUv.y)));
float field = 0.65 * n + 0.35 * (1.0 - edge);
float threshold = 1.0 - uHeat;
float k = uHeat < 0.02 ? 0.0 : smoothstep(threshold - 0.05, threshold + 0.05, 1.0 - field);
vec3 ember = emberRamp(k);
vec3 warm = srgbToLin(vec3(122.0, 23.0, 10.0)/255.0);
diffuseColor.rgb = mix(diffuseColor.rgb, warm, 0.06 * uHeat);
vec3 solar = srgbToLin(vec3(22.0, 48.0, 110.0)/255.0);
float cell = min(abs(fract(heatUv.x * 5.0) - 0.5), abs(fract(heatUv.y * 7.0) - 0.5));
float grid = smoothstep(0.02, 0.07, cell);
vec3 solarCol = solar * mix(0.62, 1.0, grid);
diffuseColor.rgb = solarCol;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float streak = texture2D(uNoise, heatUv * vec2(8.0, 1.0)).r;
roughnessFactor *= mix(0.82, 1.18, streak);
roughnessFactor = 0.42;`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = 0.12;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance = solarCol * 0.25;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
gl_FragColor.a *= vMix;`,
      );
  };
  mat.transparent = true;
  mat.depthWrite = false;
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
  if (tiles) return createTileMaterial(heat01);
  return createEmberMaterial({ heat01, noise });
}

export function setHeat(mat: HeatMaterial, heat01: number): void {
  mat.userData.heat.value = heat01;
}
