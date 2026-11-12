import { describe, expect, it } from 'vitest';
import { instanceBudget, maxTilesPerSatellite } from './capacity';

describe('satellite instance capacity', () => {
  it('covers the slider extremes with a 10% margin', () => {
    const stride = maxTilesPerSatellite();
    expect(stride).toBeGreaterThan(1800);
    expect(stride).toBeLessThan(4000);
  });

  it('drops the desktop near cap to 60 when 150 satellites would not fit', () => {
    const stride = maxTilesPerSatellite();
    const desk = instanceBudget(stride, false);
    expect(desk.nearCap).toBe(60);
    expect(desk.maxInstances).toBe(60 * stride);
    expect(instanceBudget(256, false)).toEqual({ nearCap: 150, maxInstances: 38400 });
  });

  it('keeps a phone under 6000 instances', () => {
    const stride = maxTilesPerSatellite();
    const phone = instanceBudget(stride, true);
    expect(phone.maxInstances).toBeLessThanOrEqual(6000);
    expect(phone.nearCap).toBeGreaterThanOrEqual(1);
  });
});
