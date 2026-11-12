import { subscribePerf, type PerfSample } from './renderer';

/** Dev overlay. Visible only when the URL contains `perf=1`. */
export function mountPerfHud(): void {
  if (!location.href.includes('perf=1')) return;
  const root = document.createElement('div');
  root.className = 'perf-hud';
  root.setAttribute('aria-hidden', 'true');
  document.getElementById('stage')?.append(root);

  const times: { t: number; dt: number }[] = [];
  let last: PerfSample | null = null;
  let lastAt = 0;

  const paint = () => {
    const now = performance.now();
    while (times.length && now - times[0]!.t > 2000) times.shift();
    const recent = times.filter((row) => now - row.t <= 1000);
    const avg = recent.length ? recent.reduce((sum, row) => sum + row.dt, 0) / recent.length : 0;
    const worst = times.reduce((max, row) => Math.max(max, row.dt), 0);
    const fps = avg > 0 ? 1000 / avg : 0;
    const idle = !last || now - lastAt > 250;
    const lines = [
      idle ? 'FPS idle' : `FPS ${fps.toFixed(0)}  avg ${avg.toFixed(1)} ms  worst ${worst.toFixed(1)} ms`,
      last
        ? `calls ${last.calls}  tris ${last.triangles.toLocaleString('en-US')}  tex ${last.textures}`
        : 'calls —',
      `pixel ratio ${last ? last.pixelRatio.toFixed(3) : '—'}`,
      `animations ${idle ? 0 : (last?.animations ?? 0)}`,
      `scene ${last?.scene ?? '—'}`,
    ];
    root.textContent = lines.join('\n');
  };

  subscribePerf((sample) => {
    last = sample;
    lastAt = performance.now();
    if (sample.rendered) times.push({ t: lastAt, dt: sample.dtMs });
  });
  window.setInterval(paint, 200);
}
