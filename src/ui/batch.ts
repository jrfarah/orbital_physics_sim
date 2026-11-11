let queued = false;
const jobs: Array<() => void> = [];

/** Coalesce physics updates to one callback per animation frame. */
export function coalesce(fn: () => void): void {
  jobs.push(fn);
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const run = jobs.splice(0, jobs.length);
    for (const job of run) job();
  });
}
