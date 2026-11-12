import { Vector3 } from 'three';

/** Standard ECI with Z north, then mapped to three.js (Y north): (x, y, z) = (X, Z, -Y). */
export function orbitPosition(r: number, i: number, raan: number, u: number, out: Vector3): Vector3 {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cO = Math.cos(raan);
  const sO = Math.sin(raan);
  const ci = Math.cos(i);
  const si = Math.sin(i);
  const X = r * (cO * cu - sO * su * ci);
  const Y = r * (sO * cu + cO * su * ci);
  const Z = r * (su * si);
  return out.set(X, Z, -Y);
}
