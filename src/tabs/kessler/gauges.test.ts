import { describe, expect, it } from 'vitest';
import { lifetimeAngle } from './gauges';

describe('debris lifetime gauge', () => {
  it('maps one year to the left and 10,000 years to the right', () => {
    expect(lifetimeAngle(1)).toBeCloseTo(180);
    expect(lifetimeAngle(10)).toBeCloseTo(135);
    expect(lifetimeAngle(100)).toBeCloseTo(90);
    expect(lifetimeAngle(1000)).toBeCloseTo(45);
    expect(lifetimeAngle(10000)).toBeCloseTo(0);
    expect(lifetimeAngle(1e8)).toBeCloseTo(0);
  });
});