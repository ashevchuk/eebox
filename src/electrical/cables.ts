export const INSTALL_METHODS = ['B1', 'B2', 'C', 'E'] as const;
export type InstallMethod = (typeof INSTALL_METHODS)[number];

export const CROSS_SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35] as const;

/** Conductors that carry current: a single-phase circuit has two, a balanced three-phase one has three. */
export type LoadedConductors = 2 | 3;

/**
 * Current-carrying capacity in amperes per cross-section, in the order of `CROSS_SECTIONS_MM2`,
 * for copper conductors with PVC insulation at 30 °C ambient, after IEC 60364-5-52.
 */
const AMPACITY_A: Record<InstallMethod, Record<LoadedConductors, readonly number[]>> = {
  B1: { 2: [17.5, 24, 32, 41, 57, 76, 101, 125], 3: [15.5, 21, 28, 36, 50, 68, 89, 110] },
  B2: { 2: [16.5, 23, 30, 38, 52, 69, 90, 111], 3: [15, 20, 27, 34, 46, 62, 80, 99] },
  C: { 2: [19.5, 27, 36, 46, 63, 85, 112, 138], 3: [17.5, 24, 32, 41, 57, 76, 96, 119] },
  E: { 2: [22, 30, 40, 51, 70, 94, 119, 148], 3: [18.5, 25, 34, 43, 60, 80, 101, 126] },
};

/** The table was written down without the standard at hand; it has to be checked before anyone relies on it. */
export const CABLE_TABLE_NOTE =
  'Reference values for copper, PVC insulation, 30 °C ambient. Not verified against IEC 60364-5-52: check them before relying on a result.';

export function ampacityA(method: InstallMethod, loaded: LoadedConductors, sectionMm2: number): number | undefined {
  const index = (CROSS_SECTIONS_MM2 as readonly number[]).indexOf(sectionMm2);
  return index < 0 ? undefined : AMPACITY_A[method][loaded][index];
}

/** The smallest listed cross-section that carries `currentA`, or undefined when even the largest does not. */
export function minimumSectionMm2(method: InstallMethod, loaded: LoadedConductors, currentA: number): number | undefined {
  return CROSS_SECTIONS_MM2.find((section) => (ampacityA(method, loaded, section) ?? 0) >= currentA);
}
