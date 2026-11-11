import {
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { getNoiseTexture, sampleNoise } from './noise';

const STOPS: { t: number; rgb: [number, number, number] }[] = [
  { t: 0, rgb: [42, 8, 4] },
  { t: 0.35, rgb: [122, 23, 10] },
  { t: 0.65, rgb: [194, 52, 26] },
  { t: 1, rgb: [255, 122, 46] },
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

const HEAT_GLSL = /* glsl */ `
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

export interface HeatMaterial extends MeshStandardMaterial {
  userData: { heat: { value: number } };
}

export function createHeatMaterial(heat01 = 0, tiles = false): HeatMaterial {
  const heat = { value: heat01 };
  const mat = new MeshStandardMaterial({
    color: 0x3d424a,
    metalness: 0.85,
    roughness: 0.38,
    map: whiteMap(),
  }) as HeatMaterial;
  mat.userData.heat = heat;
  mat.customProgramCacheKey = () => (tiles ? 'heat-tiles-v2' : 'heat-face-v2');
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uHeat = heat;
    shader.uniforms.uNoise = { value: getNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${tiles ? 'attribute float aScale;\nattribute float aMix;\nvarying float vMix;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        tiles ? 'vec3 transformed = vec3(position) * aScale;\nvMix = aMix;' : '#include <begin_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHeat;
uniform sampler2D uNoise;
${tiles ? 'varying float vMix;' : ''}
${HEAT_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 heatUv = vMapUv;
float n = texture2D(uNoise, heatUv).r;
float edge = 1.0 - smoothstep(0.0, 0.5, min(min(heatUv.x, 1.0-heatUv.x), min(heatUv.y, 1.0-heatUv.y)));
float field = 0.65 * n + 0.35 * (1.0 - edge);
float threshold = 1.0 - uHeat;
float k = uHeat < 0.02 ? 0.0 : smoothstep(threshold - 0.05, threshold + 0.05, 1.0 - field);
vec3 ember = emberRamp(k);
vec3 warm = srgbToLin(vec3(122.0, 23.0, 10.0)/255.0);
diffuseColor.rgb = mix(diffuseColor.rgb, warm, 0.06 * uHeat);
${
  tiles
    ? `vec3 solar = srgbToLin(vec3(22.0, 48.0, 110.0)/255.0);
float cell = min(abs(fract(heatUv.x * 5.0) - 0.5), abs(fract(heatUv.y * 7.0) - 0.5));
float grid = smoothstep(0.02, 0.07, cell);
vec3 solarCol = solar * mix(0.62, 1.0, grid);
diffuseColor.rgb = mix(diffuseColor.rgb, solarCol, vMix);`
    : ''
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float streak = texture2D(uNoise, heatUv * vec2(8.0, 1.0)).r;
roughnessFactor *= mix(0.82, 1.18, streak);
${tiles ? 'roughnessFactor = mix(roughnessFactor, 0.42, vMix);' : ''}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
${tiles ? 'metalnessFactor = mix(metalnessFactor, 0.12, vMix);' : ''}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += ember * (0.15 + 1.6 * k);
${tiles ? 'totalEmissiveRadiance = mix(totalEmissiveRadiance, solarCol * 0.25, vMix);' : ''}`,
      );
  };
  return mat;
}

export function setHeat(mat: HeatMaterial, heat01: number): void {
  mat.userData.heat.value = heat01;
}
