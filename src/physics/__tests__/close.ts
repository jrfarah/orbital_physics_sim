import { expect } from 'vitest';

/** Relative tolerance 1e-4, or absolute 1e-9 for values near zero. */
export function expectClose(actual: number, expected: number): void {
  const diff = Math.abs(actual - expected);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    expect(actual).toBe(expected);
    return;
  }
  if (Math.abs(expected) < 1e-8) {
    expect(diff, `abs ${actual} vs ${expected}`).toBeLessThanOrEqual(1e-9);
  } else {
    expect(diff / Math.abs(expected), `rel ${actual} vs ${expected}`).toBeLessThanOrEqual(1e-4);
  }
}
