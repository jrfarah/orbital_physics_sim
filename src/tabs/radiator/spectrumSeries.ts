import type { FaceFlux } from '../../physics/radiator';
import { fmtSig } from '../../ui/format';
import { zoomWords } from './spectrumStore';

const PARTS = [
  { key: 'sun', title: 'Sunlight', color: '#ffd36b', q: (face: FaceFlux) => face.q_sun },
  { key: 'reflected', title: 'Reflected off Earth', color: '#7fb6ff', q: (face: FaceFlux) => face.q_alb },
  { key: 'earth', title: "Earth's infrared glow", color: '#ff8a5c', q: (face: FaceFlux) => face.q_ir },
  { key: 'cmb', title: '3 K sky', color: '#b58cff', q: (face: FaceFlux) => face.q_cmb },
] as const;

export interface IncomingSeries {
  key: (typeof PARTS)[number]['key'];
  label: string;
  color: string;
}

/** Nonzero light arriving at the face. A component that is exactly 0 is omitted. */
export function incomingSeries(face: FaceFlux): IncomingSeries[] {
  return PARTS.filter((part) => part.q(face) !== 0).map((part) => ({
    key: part.key,
    color: part.color,
    label: `${part.title} · ${fmtSig(part.q(face))} W/m²`,
  }));
}

/**
 * Magnify hint for the 3 K sky. `brightPeak` is the tallest incoming curve other than the sky,
 * so the panel's own emission never sets the number.
 */
export function skyCallout(brightPeak: number, cmbPeak: number, zoom: number, log: boolean): string | null {
  if (log || !(cmbPeak > 0) || !(brightPeak > 0)) return null;
  const yMax = Math.max(brightPeak, cmbPeak) / zoom;
  if (cmbPeak >= yMax * 0.02) return `3 K sky visible at ${zoomWords(zoom)}`;
  return `${zoomWords((0.02 * brightPeak) / cmbPeak)} to see the 3 K sky`;
}
