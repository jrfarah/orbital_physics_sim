/** Number and unit formatting. Model outputs are shown to at most 3 significant figures. */

export function roundSig(x: number, sig = 3): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const ax = Math.abs(x);
  const p = Math.floor(Math.log10(ax) + 1e-12);
  const m = 10 ** (sig - 1 - p);
  return Math.sign(x) * Math.round(ax * m) / m;
}

function fracDigits(ax: number, sig: number): number {
  if (ax === 0) return 0;
  const p = Math.floor(Math.log10(ax) + 1e-12);
  return Math.max(0, sig - 1 - p);
}

/** Three significant figures with thousands separators. */
export function fmtSig(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax < 1e-3) {
    const exp = Math.floor(Math.log10(ax) + 1e-12);
    const mantissa = x / 10 ** exp;
    return `${fmtSig(mantissa, sig)}e${exp}`;
  }
  const r = roundSig(x, sig);
  const digits = fracDigits(Math.abs(r), sig);
  return r.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: true,
  });
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Below 1e6, comma format at 3 sig figs. At or above 1e6, words ("184 billion"). */
export function fmtBig(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const ax = Math.abs(x);
  const units: [number, string][] = [
    [1e15, 'quadrillion'],
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  if (ax < 1e6) return fmtSig(x, 3);
  for (const [div, name] of units) {
    if (ax >= div) {
      const coeff = stripTrailingZeros(fmtSig(x / div, 3));
      return `${coeff} ${name}`;
    }
  }
  return fmtSig(x, 3);
}

export function fmtUSD(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const sign = x < 0 ? '-' : '';
  return `${sign}$${fmtBig(Math.abs(x))}`;
}

/**
 * Below 1e4 m²: "551 m²". From 1e4 to 1e6 m²: "0.55 km²".
 * At or above 1e6 m²: km² with commas ("4,590 km²").
 */
export function fmtArea(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (Math.abs(m2) < 1e4) return `${fmtSig(m2, 3)} m²`;
  const km2 = m2 / 1e6;
  const body = Math.abs(m2) < 1e6 ? stripTrailingZeros(fmtSig(km2, 3)) : fmtSig(km2, 3);
  return `${body} km²`;
}

/** Hectares sub-label for areas between 1e4 and 1e6 m². */
export function fmtAreaSub(m2: number): string | null {
  if (m2 >= 1e4 && m2 < 1e6) return `${stripTrailingZeros(fmtSig(m2 / 1e4, 3))} ha`;
  return null;
}

/**
 * "320 K" with a Celsius sub-label.
 * DECISION: Celsius uses 273, so 320 K reads "47 °C" as specified.
 */
export function fmtTemp(k: number): { main: string; sub: string } {
  const c = k - 273;
  const cText = Math.abs(c) >= 100 ? fmtSig(c, 3) : String(Math.round(c));
  return { main: `${fmtSig(k, 3)} K`, sub: `${cText} °C` };
}

export function fmtDuration(years: number): string {
  if (!Number.isFinite(years)) return '—';
  if (years >= 10000) return '10,000+ years';
  return `${stripTrailingZeros(fmtSig(years, 3))} years`;
}

/** 1 significant figure, in words, for the spectrum magnification callout. */
export function fmtTimesWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '×1';
  const exp = Math.floor(Math.log10(n) + 1e-12);
  const rounded = Math.round(n / 10 ** exp) * 10 ** exp;
  const units: [number, string][] = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [div, name] of units) {
    if (rounded >= div) {
      const coeff = stripTrailingZeros(fmtSig(rounded / div, 2));
      return `×${coeff} ${name}`;
    }
  }
  return `×${fmtSig(rounded, 1)}`;
}
