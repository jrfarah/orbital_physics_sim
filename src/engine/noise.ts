import { DataTexture, LinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

const SIZE = 256;

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ 0x4b1d1d3;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const v00 = hash2(x0, y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

function fbm(x: number, y: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

let data: Float32Array | null = null;
let texture: DataTexture | null = null;

function build(): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      out[y * SIZE + x] = fbm(x / 32, y / 32);
    }
  }
  return out;
}

/** Shared deterministic FBM, values in 0..1. */
export function getNoiseData(): Float32Array {
  if (!data) data = build();
  return data;
}

export function sampleNoise(u: number, v: number): number {
  const src = getNoiseData();
  const x = ((u % 1) + 1) % 1 * SIZE;
  const y = ((v % 1) + 1) % 1 * SIZE;
  const x0 = Math.floor(x) % SIZE;
  const y0 = Math.floor(y) % SIZE;
  const x1 = (x0 + 1) % SIZE;
  const y1 = (y0 + 1) % SIZE;
  const tx = x - Math.floor(x);
  const ty = y - Math.floor(y);
  const v00 = src[y0 * SIZE + x0];
  const v10 = src[y0 * SIZE + x1];
  const v01 = src[y1 * SIZE + x0];
  const v11 = src[y1 * SIZE + x1];
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

export function getNoiseTexture(): DataTexture {
  if (texture) return texture;
  const src = getNoiseData();
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < src.length; i++) {
    const v = Math.round(src[i] * 255);
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  texture = new DataTexture(rgba, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
