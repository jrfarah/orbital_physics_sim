import { earthTextureLine } from './earth';
import { subscribePerf, type PerfSample } from './renderer';

function uploadBytes(): number {
  const counter = (window as Window & { __uploads?: { bytes: () => number } }).__uploads;
  return counter?.bytes() ?? 0;
}

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
    const heapMb = last ? last.heap / (1024 * 1024) : 0;
    const lines = [
      idle ? 'FPS idle' : `FPS ${fps.toFixed(0)}  avg ${avg.toFixed(1)} ms  worst ${worst.toFixed(1)} ms`,
      last
        ? `calls ${last.calls}  tris ${last.triangles.toLocaleString('en-US')}  tex ${last.textures}`
        : 'calls —',
      last
        ? `programs ${last.programs}  geometries ${last.geometries}  textures ${last.textures}`
        : 'programs —',
      last ? `meshes ${last.meshes}  instances ${last.instances.toLocaleString('en-US')}` : 'meshes —',
      `heap ${last ? heapMb.toFixed(1) : '—'} MB`,
      `loop ${idle || !last?.looping ? 'idle' : last.reason || 'running'}`,
      `pixel ratio ${last ? last.pixelRatio.toFixed(3) : '—'}`,
      `animations ${idle ? 0 : (last?.animations ?? 0)}`,
      `scene ${last?.scene ?? '—'}`,
      `attribute uploads ${uploadBytes().toLocaleString('en-US')} B`,
      earthTextureLine(),
    ];
    root.textContent = lines.join('\n');
    const view = window as Window & { __perf?: Record<string, unknown> };
    view.__perf = {
      idle: idle || !last?.looping,
      fps,
      programs: last?.programs ?? 0,
      geometries: last?.geometries ?? 0,
      textures: last?.textures ?? 0,
      meshes: last?.meshes ?? 0,
      instances: last?.instances ?? 0,
      heap: last?.heap ?? 0,
      looping: Boolean(last?.looping) && !idle,
      reason: idle || !last?.looping ? 'idle' : last?.reason || '',
      renderedFrames: last?.renderedFrames ?? 0,
      scene: last?.scene ?? '',
    };
  };

  subscribePerf((sample) => {
    last = sample;
    lastAt = performance.now();
    if (sample.rendered) times.push({ t: lastAt, dt: sample.dtMs });
    const view = window as Window & { __perf?: Record<string, unknown> };
    view.__perf = {
      programs: sample.programs,
      geometries: sample.geometries,
      textures: sample.textures,
      meshes: sample.meshes,
      instances: sample.instances,
      heap: sample.heap,
      looping: sample.looping,
      reason: sample.reason,
      renderedFrames: sample.renderedFrames,
      scene: sample.scene,
    };
  });
  window.setInterval(paint, 200);
}
