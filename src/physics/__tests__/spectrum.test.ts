import { describe, it, expect } from 'vitest';
import { radiator } from '../radiator';
import { faceSpectrum } from '../spectrum';

function integrate(component: 'sun' | 'earth_ir', face: { q_sun: number; q_alb: number; q_ir: number; q_cmb: number }): number {
  const n = 4000;
  const ln0 = Math.log(1e-7); // 0.1 µm
  const ln1 = Math.log(1e-2); // 10 mm
  const dln = (ln1 - ln0) / (n - 1);
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const lam = Math.exp(ln0 + dln * i);
    ys.push(faceSpectrum(lam, face)[component]);
  }
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += 0.5 * (ys[i] + ys[i + 1]) * dln;
  return sum;
}

describe('spectrum integrals', () => {
  it('noon-flat face A sunlight integrates to 1361 within 0.5%', () => {
    const face = radiator(500, [1, 0, 0], [1, 0, 0]).A;
    const integral = integrate('sun', face);
    expect(Math.abs(integral - 1361) / 1361).toBeLessThanOrEqual(0.005);
  });

  it('dawn-dusk face A Earth IR integrates to 64.149 within 0.5%', () => {
    const face = radiator(500, [0, 1, 0], [0, 0, 1]).A;
    const integral = integrate('earth_ir', face);
    expect(Math.abs(integral - 64.149) / 64.149).toBeLessThanOrEqual(0.005);
  });
});
