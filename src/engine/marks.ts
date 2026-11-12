/** Frame and long-task attribution. Cheap enough to leave on. */

type Span = { name: string; start: number; end: number };
type Hit = { at: number; ms: number; names: string[] };

const spans: Span[] = [];
const slow: Hit[] = [];
const longs: Hit[] = [];

function overlap(start: number, end: number): string[] {
  const names: string[] = [];
  for (let i = spans.length - 1; i >= 0 && names.length < 8; i--) {
    const span = spans[i]!;
    if (span.end < start - 1) continue;
    if (span.start > end + 1) continue;
    names.push(`${span.name}:${(span.end - span.start).toFixed(1)}`);
  }
  return names;
}

export function span<T>(name: string, fn: () => T): T {
  const start = performance.now();
  performance.mark(`${name}:start`);
  try {
    return fn();
  } finally {
    const end = performance.now();
    performance.mark(`${name}:end`);
    spans.push({ name, start, end });
    if (spans.length > 600) spans.splice(0, spans.length - 600);
  }
}

export function noteSlow(ms: number): void {
  if (ms <= 20) return;
  const end = performance.now();
  slow.push({ at: end, ms, names: overlap(end - ms, end) });
  if (slow.length > 80) slow.shift();
}

export function stallReport(): { slow: Hit[]; longs: Hit[] } {
  return { slow: slow.slice(), longs: longs.slice() };
}

export function resetStalls(): void {
  slow.length = 0;
  longs.length = 0;
  spans.length = 0;
}

function install(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        longs.push({
          at: entry.startTime + entry.duration,
          ms: entry.duration,
          names: overlap(entry.startTime, entry.startTime + entry.duration),
        });
        if (longs.length > 40) longs.shift();
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    /* longtask is not available in every browser */
  }
  const view = window as Window & {
    __stalls?: () => { slow: Hit[]; longs: Hit[] };
    __stallsReset?: () => void;
  };
  view.__stalls = stallReport;
  view.__stallsReset = resetStalls;
}

install();
