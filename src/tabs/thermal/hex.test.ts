import { describe, expect, it } from 'vitest';
import { axialFromIndex, hexOuterRadius, indexFromAxial, ringOf } from './hex';

describe('hex spiral', () => {
  it('round-trips index to axial to index through 1e7', () => {
    const check = (index: number) => {
      const [q, r] = axialFromIndex(index);
      expect(indexFromAxial(q, r), `${index} -> ${q},${r}`).toBe(index);
      expect(ringOf(index)).toBe(Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)));
    };
    for (let index = 0; index < 5000; index++) check(index);
    for (let index = 5000; index <= 10_000_000; index += 7919) check(index);
    check(10_000_000);
  });

  it('fills rings in order', () => {
    expect(axialFromIndex(0)).toEqual([0, 0]);
    expect(ringOf(1)).toBe(1);
    expect(ringOf(6)).toBe(1);
    expect(ringOf(7)).toBe(2);
    const seen = new Set<string>();
    for (let index = 0; index < 200; index++) {
      const [q, r] = axialFromIndex(index);
      seen.add(`${q},${r}`);
    }
    expect(seen.size).toBe(200);
  });

  it('grows the outer radius continuously', () => {
    const spacing = 2;
    const rSat = 1;
    let prev = 0;
    for (let n = 1; n <= 40; n += 0.25) {
      const radius = hexOuterRadius(n, spacing, rSat);
      expect(radius).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = radius;
    }
    expect(hexOuterRadius(1, spacing, rSat)).toBe(rSat);
  });
});
