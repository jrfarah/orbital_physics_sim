/** Closed-form hexagonal spiral. The shader uses the same indexing. */

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const SATELLITE_W = 120e3;

/** Ring of a spiral index. The center cell is ring 0. */
export function ringOf(index: number): number {
  if (index <= 0) return 0;
  let k = Math.ceil((3 + Math.sqrt(12 * index - 3)) / 6);
  if (3 * k * (k - 1) + 1 > index) k -= 1;
  return k;
}

/** Axial coordinate of spiral index. Ring k position j has index 3k(k-1)+1+j. */
export function axialFromIndex(index: number): [number, number] {
  if (index <= 0) return [0, 0];
  const k = ringOf(index);
  const j = index - (3 * k * (k - 1) + 1);
  const side = Math.floor(j / k);
  const step = j - side * k;
  let q = -k;
  let r = k;
  for (let s = 0; s < side; s++) {
    q += DIRS[s]![0] * k;
    r += DIRS[s]![1] * k;
  }
  q += DIRS[side]![0] * step;
  r += DIRS[side]![1] * step;
  return [q, r];
}

/** Inverse of axialFromIndex. */
export function indexFromAxial(q: number, r: number): number {
  if (q === 0 && r === 0) return 0;
  const k = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  let side = 0;
  let step = 0;
  if (r === k && q >= -k && q < 0) {
    side = 0;
    step = q + k;
  } else if (q + r === k && q >= 0 && r > 0) {
    side = 1;
    step = q;
  } else if (q === k && r <= 0 && r > -k) {
    side = 2;
    step = -r;
  } else if (r === -k && q > 0 && q <= k) {
    side = 3;
    step = k - q;
  } else if (q + r === -k && q <= 0 && q > -k && r < 0) {
    side = 4;
    step = -q;
  } else {
    side = 5;
    step = r;
  }
  return 3 * k * (k - 1) + 1 + side * k + step;
}

/** Pointy-top axial to world XZ. `spacing` is the distance between cell centers. */
export function axialToWorld(q: number, r: number, spacing: number): [number, number] {
  return [spacing * (q + r * 0.5), spacing * (Math.sqrt(3) / 2) * r];
}

/**
 * Outer radius of the occupied region. Grows through a partial ring so the
 * camera does not jump when a new ring starts.
 */
export function hexOuterRadius(n: number, spacing: number, rSat: number): number {
  if (!(n > 1)) return rSat;
  const last = Math.max(0, n - 1);
  const k = ringOf(Math.floor(last));
  if (k <= 0) return rSat + Math.min(1, last) * (spacing / 6);
  const start = 3 * k * (k - 1) + 1;
  const fill = Math.min(1, Math.max(0, (last - start + 1) / (6 * k)));
  return (k - 1 + fill) * spacing + rSat;
}
