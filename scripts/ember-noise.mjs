import sharp from 'sharp';

const SIZE = 1024;

function hash2(ix, iy) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ 0x4b1d1d3;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function noise(x, y, period) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const wrap = (v) => ((v % period) + period) % period;
  const xi = wrap(x0);
  const yi = wrap(y0);
  const x1 = wrap(x0 + 1);
  const y1 = wrap(y0 + 1);
  const v00 = hash2(xi, yi);
  const v10 = hash2(x1, yi);
  const v01 = hash2(xi, y1);
  const v11 = hash2(x1, y1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

function fbm(u, v) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let freq = 4;
  for (let o = 0; o < 5; o++) {
    sum += amp * noise(u * freq, v * freq, freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function ridged(u, v) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let freq = 8;
  for (let o = 0; o < 4; o++) {
    const n = noise(u * freq + 19.2, v * freq + 7.7, freq);
    sum += amp * (1 - Math.abs(n * 2 - 1));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  const v = y / SIZE;
  for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE;
    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.round(Math.min(1, Math.max(0, fbm(u, v))) * 255);
    rgba[i + 1] = Math.round(Math.min(1, Math.max(0, ridged(u, v))) * 255);
    rgba[i + 3] = 255;
  }
}

await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png({ compressionLevel: 9 }).toFile('public/textures/ember_noise.png');
console.log('wrote public/textures/ember_noise.png');
