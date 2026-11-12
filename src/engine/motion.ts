/** Animations lock the pixel ratio and render-target sizes for their whole duration. */
let hold = 0;

export function holdMotion(on: boolean): void {
  hold += on ? 1 : -1;
  if (hold < 0) hold = 0;
}

export function motionHeld(): boolean {
  return hold > 0;
}
