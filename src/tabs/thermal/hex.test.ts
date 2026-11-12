import { describe, expect, it } from 'vitest';
import { axialFromIndex, BLOCK_M, blockCount, footprintRadius, hexOuterRadius, indexFromAxial, ringOf } from './hex';

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

  it('keeps the footprint continuous across one gigawatt block', () => {
    const spacing = 20;
    const rSat = 9;
    const at = footprintRadius(BLOCK_M, spacing, rSat);
    expect(at).toBeCloseTo(hexOuterRadius(BLOCK_M, spacing, rSat), 6);
    const justUnder = footprintRadius(BLOCK_M - 0.25, spacing, rSat);
    const justOver = footprintRadius(BLOCK_M + 0.01, spacing, rSat);
    expect(justUnder).toBeLessThanOrEqual(at + 1e-6);
    expect(justOver).toBeGreaterThanOrEqual(at - 1e-6);
    expect(Math.abs(justOver - at) / at).toBeLessThan(1e-3);
    expect(blockCount(BLOCK_M)).toBe(1);
    expect(blockCount(BLOCK_M + 1)).toBe(2);
    expect(blockCount(Math.ceil(10e9 / 120e3))).toBe(10);
    expect(blockCount(Math.ceil(100e9 / 120e3))).toBe(100);
    expect(blockCount(Math.ceil(1e12 / 120e3))).toBe(1000);
  });
});
