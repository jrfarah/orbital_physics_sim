import { describe, expect, it } from 'vitest';
import { fmtArea, fmtBig, fmtUSD } from './format';

describe('format', () => {
  it('matches the specified examples', () => {
    expect(fmtBig(1.84e11)).toBe('184 billion');
    expect(fmtBig(249908)).toBe('250,000');
    expect(fmtArea(4.588e9)).toBe('4,590 km²');
    expect(fmtUSD(5.5e10)).toBe('$55 billion');
  });
});
