/** Missing deviceMemory is treated as 4 GB so a phone does not take the desktop texture path. */
export function deviceMemoryGb(): number {
  try {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number' && Number.isFinite(mem) && mem > 0) return mem;
  } catch {
    /* a restricted navigator */
  }
  return 4;
}

export function onIdle(fn: () => void): number {
  const ric = window.requestIdleCallback;
  if (typeof ric === 'function') return ric(() => fn());
  return window.setTimeout(fn, 500);
}
