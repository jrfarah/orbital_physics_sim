import { thermalBudget } from '../../physics/thermal';

const TILE = 5;

/**
 * Tiles one 120 kW satellite can need at the slider extremes, plus 10%.
 * The instance stride has to cover this or the extra tiles have no index.
 */
export function maxTilesPerSatellite(): number {
  let maxArea = TILE;
  const gpus = [330, 400];
  const drops = [5, 60];
  const emissivities = [0.8, 1];
  const loads = [0, 200];
  const cells = [0.15, 0.35];
  const packs = [0.7, 1];
  const suns = [0.6, 1];
  for (const T_gpu_max of gpus) {
    for (const dT_chain of drops) {
      for (const eps of emissivities) {
        for (const q_env_face of loads) {
          for (const pv_eff of cells) {
            for (const packing of packs) {
              for (const sunlit of suns) {
                for (const pump of [false, true]) {
                  const hots = pump ? [333, 600] : [400];
                  const etas = pump ? [0.2, 1] : [0.5];
                  for (const T_hot of hots) {
                    for (const carnot_frac of etas) {
                      const area = thermalBudget({
                        P: 120e3,
                        T_gpu_max,
                        dT_chain,
                        eps,
                        q_env_face,
                        pv_eff,
                        packing,
                        sunlit,
                        pump,
                        T_hot,
                        carnot_frac,
                      }).A_tot;
                      if (Number.isFinite(area) && area > maxArea) maxArea = area;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  const tiles = Math.max(1, Math.round(maxArea / TILE));
  return Math.max(1, Math.ceil(tiles * 1.1));
}

/**
 * 150 × stride fit the frame budget at stride 256 (38,400 instances).
 * A larger stride drops the near threshold to 60 satellites instead of clipping tiles.
 * Mobile keeps the instanced mesh at or under 6,000 slots.
 */
export function instanceBudget(stride: number, mobile: boolean): { nearCap: number; maxInstances: number } {
  const safe = Math.max(1, stride);
  if (mobile) {
    const nearCap = Math.max(1, Math.floor(6000 / safe));
    return { nearCap, maxInstances: nearCap * safe };
  }
  const nearCap = 150 * safe <= 38400 ? 150 : 60;
  return { nearCap, maxInstances: nearCap * safe };
}
