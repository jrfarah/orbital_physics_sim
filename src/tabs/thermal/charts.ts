import { qNetBothFaces, thermalBudget, type ThermalInput } from '../../physics/thermal';
import { createChart } from '../../ui/charts';
import { fmtSig } from '../../ui/format';
import { el } from '../../ui/readout';

export function createThermalCharts(): { element: HTMLElement; update: (input: ThermalInput, tHot: number) => void } {
  const element = el('div');
  const aHost = el('div');
  const bHost = el('div');
  const aNote = el('div', 'sub');
  const bNote = el('div', 'sub');
  element.append(el('h2', 'section-title', 'Heat shed per m² vs radiator temperature'), aHost, aNote);
  element.append(el('h2', 'section-title', 'Total area vs radiator temperature'), bHost, bNote);
  const chartA = createChart(aHost, 1.7);
  const chartB = createChart(bHost, 1.7);

  return {
    element,
    update(input, tHot) {
      const base = thermalBudget({ ...input, pump: false, T_hot: null });
      const cold = base.T_cold;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let t = 200; t <= 650; t += 8) {
        xs.push(t);
        ys.push(qNetBothFaces(t, input.eps ?? 0.9, input.q_env_face ?? 57.7));
      }
      const q250 = qNetBothFaces(250, input.eps ?? 0.9, input.q_env_face ?? 57.7);
      const qCold = qNetBothFaces(cold, input.eps ?? 0.9, input.q_env_face ?? 57.7);
      chartA.draw({
        xDomain: [200, 650],
        yDomain: [Math.min(0, ...ys), Math.max(...ys, 1) * 1.05],
        xLabel: 'Radiator temperature (K)',
        yLabel: 'W/m²',
        series: [{ name: 'Heat shed', color: '#5ce1ff', xs, ys }],
        vLines: [{ x: cold, color: '#ffb547', label: 'Chip limit (no heat pump)' }],
        shade: [{ x0: cold, x1: 650, color: 'rgba(255,77,77,0.08)', label: 'Needs a heat pump' }],
        points: [{ x: tHot, y: qNetBothFaces(tHot, input.eps ?? 0.9, input.q_env_face ?? 57.7), color: '#e6edf5', label: 'You are here' }],
      });
      const ratio = q250 > 0 ? qCold / q250 : Infinity;
      aNote.textContent = `Going from 250 K to the chip limit changes this by ×${fmtSig(ratio)}`;

      const tx: number[] = [];
      const rad: number[] = [];
      const sol: number[] = [];
      const tot: number[] = [];
      let bestT = cold;
      let bestA = Infinity;
      for (let i = 0; i <= 80; i++) {
        const t = cold + ((600 - cold) * i) / 80;
        const row = thermalBudget({ ...input, pump: true, T_hot: t });
        tx.push(t);
        rad.push(row.A_rad);
        sol.push(row.A_sol);
        tot.push(row.A_tot);
        if (row.A_tot < bestA) {
          bestA = row.A_tot;
          bestT = t;
        }
      }
      const here = thermalBudget({ ...input, pump: true, T_hot: tHot });
      const finite = tot.filter((v) => Number.isFinite(v));
      const yMax = Math.max(base.A_tot, Number.isFinite(here.A_tot) ? here.A_tot : 0, ...(finite.length ? finite : [1])) * 1.08;
      chartB.draw({
        xDomain: [cold, 600],
        yDomain: [0, yMax],
        xLabel: 'Radiator temperature (K)',
        yLabel: 'Area (m²)',
        series: [
          { name: 'Radiator', color: '#c5ccd6', xs: tx, ys: rad },
          { name: 'Solar', color: '#2a5bd7', xs: tx, ys: sol },
          { name: 'Total', color: '#5ce1ff', xs: tx, ys: tot, width: 3 },
        ],
        hLines: [{ y: base.A_sol, color: '#9aa9bb', label: 'Solar alone (radiator area → 0)' }],
        points: [
          { x: cold, y: base.A_tot, color: '#9aa9bb', label: 'no heat pump' },
          { x: here.T_hot, y: here.A_tot, color: '#e6edf5', label: 'you are here' },
        ],
      });
      bNote.textContent =
        bestT <= cold + 1 ? 'Best choice: no heat pump' : `Best choice: radiator at ${fmtSig(bestT)} K`;
    },
  };
}
