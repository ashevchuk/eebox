import { familyOf, type Conductor } from '../library/types';

/** A way of earthing a supply, described by what its source has to give; rules read these entries, so a new system is a new entry. */
export interface EarthingSystem {
  label: string;
  /** What the supply is, in a sentence, for the inspector. */
  description: string;
  /** The non-phase conductors the source must have. */
  required: readonly Conductor[];
  /** Non-phase conductors the source may have besides the required ones. */
  optional: readonly Conductor[];
}

export const EARTHING_SYSTEMS = {
  'TN-S': {
    label: 'TN-S',
    description: 'Neutral and protective earth are separate conductors all the way from the source.',
    required: ['N', 'PE'],
    optional: [],
  },
  'TN-C-S': {
    label: 'TN-C-S',
    description: 'The supply is a PEN conductor, split into N and PE where it enters the installation.',
    required: ['PEN'],
    optional: [],
  },
  'TN-C': {
    label: 'TN-C',
    description: 'Neutral and protective earth are one PEN conductor throughout.',
    required: ['PEN'],
    optional: [],
  },
  TT: {
    label: 'TT',
    description: 'The neutral is earthed at the source and the installation has its own earth electrode.',
    required: ['N', 'PE'],
    optional: [],
  },
  IT: {
    label: 'IT',
    description: 'The source is isolated from earth or earthed through an impedance; the neutral is usually not distributed.',
    required: ['PE'],
    optional: ['N'],
  },
} as const satisfies Record<string, EarthingSystem>;

export type EarthingSystemId = keyof typeof EARTHING_SYSTEMS;
export const EARTHING_SYSTEM_IDS = Object.keys(EARTHING_SYSTEMS) as EarthingSystemId[];

export const isEarthingSystem = (value: unknown): value is EarthingSystemId =>
  typeof value === 'string' && (EARTHING_SYSTEM_IDS as string[]).includes(value);

/** Smallest copper cross-section of a PEN conductor, from IEC 60364-5-54 (not checked against the text of the standard). */
export const PEN_MIN_SECTION_MM2 = 10;

/** What is wrong with the conductors of a source for its earthing system, or null when they fit. */
export function earthingProblem(system: EarthingSystemId, conductors: readonly Conductor[]): string | null {
  const { label, required, optional } = EARTHING_SYSTEMS[system] as EarthingSystem;
  const earthing = conductors.filter((c) => familyOf(c) !== 'phase' && familyOf(c) !== 'control');
  const missing = required.filter((c) => !earthing.includes(c));
  const extra = earthing.filter((c) => !required.includes(c) && !optional.includes(c));
  if (missing.length === 0 && extra.length === 0) return null;
  const parts = [
    ...(missing.length > 0 ? [`lacks ${missing.join(', ')}`] : []),
    ...(extra.length > 0 ? [`has ${extra.join(', ')}, which ${label} does not give`] : []),
  ];
  return `${label} supply ${parts.join(' and ')}`;
}
