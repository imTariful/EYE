export const DEFAULT_NPC_CM = 8.0;
export const DEFAULT_ACCOMMODATIVE_LAG_D = 0.75;

export interface ManualAccommodativeInputs {
  npcCm: number;
  accommodativeLagDiopters: number;
}

/**
 * Keeps manual/self-reported accommodative inputs deterministic and bounded to
 * values accepted by the Step 3 controls. No webcam-derived inference occurs.
 */
export function resolveManualAccommodativeInputs(
  npcCm: number,
  accommodativeLagDiopters: number,
): ManualAccommodativeInputs {
  return {
    npcCm: Number.isFinite(npcCm) && npcCm > 0 ? Math.min(40, npcCm) : DEFAULT_NPC_CM,
    accommodativeLagDiopters:
      Number.isFinite(accommodativeLagDiopters) && accommodativeLagDiopters >= 0
        ? Math.min(3, accommodativeLagDiopters)
        : DEFAULT_ACCOMMODATIVE_LAG_D,
  };
}
