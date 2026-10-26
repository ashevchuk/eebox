import type { ModuleDef, TerminalDef } from './types';

/**
 * The bundled library, built from standard rating series. Nothing here comes from a manufacturer's
 * catalogue: the numbers are the preferred ratings and sensitivities of the IEC product standards,
 * and the widths are the typical one 17.5 mm unit per pole.
 */
export const GENERIC_LIBRARY_ID = 'generic-iec';

const MCB_RATINGS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63];
const MCB_CURVES = ['B', 'C', 'D'] as const;
const RCD_RATINGS = [25, 40, 63, 80, 100];
const RCD_SENSITIVITIES_MA = [30, 100, 300];
const RCBO_RATINGS = [6, 10, 13, 16, 20, 25, 32, 40];
const RCBO_CURVES = ['B', 'C'] as const;
const RCBO_SENSITIVITIES_MA = [30, 300];
const SWITCH_RATINGS = [32, 40, 63, 80, 100, 125];
const CONTACTOR_RATINGS = [20, 25, 40, 63];
const MCB_BREAKING_CAPACITY_KA = 6;
const RESIZABLE_BAR = { minUnits: 2, maxUnits: 24 };
const RESIZABLE_COMB = { minUnits: 2, maxUnits: 54 };

const poleLabel = (poles: 1 | 2 | 3 | 4) => `${poles}P`;
const POLES = [1, 2, 3, 4] as const;

function breakers(): ModuleDef[] {
  return POLES.flatMap((poles) =>
    MCB_CURVES.flatMap((curve) =>
      MCB_RATINGS.map(
        (rating): ModuleDef => ({
          id: `mcb-${poles}p-${curve.toLowerCase()}${rating}`,
          kind: 'breaker',
          name: `MCB ${poleLabel(poles)} ${curve}${rating}`,
          widthUnits: poles,
          poles,
          ratedCurrentA: rating,
          curve,
          breakingCapacityKA: MCB_BREAKING_CAPACITY_KA,
        }),
      ),
    ),
  );
}

function rcds(): ModuleDef[] {
  return ([2, 4] as const).flatMap((poles) =>
    RCD_RATINGS.flatMap((rating) =>
      RCD_SENSITIVITIES_MA.map(
        (ma): ModuleDef => ({
          id: `rcd-${poles}p-${rating}-${ma}`,
          kind: 'rcd',
          name: `RCD ${poleLabel(poles)} ${rating}A ${ma}mA`,
          widthUnits: poles,
          poles,
          ratedCurrentA: rating,
          residualCurrentMa: ma,
        }),
      ),
    ),
  );
}

function rcbos(): ModuleDef[] {
  return RCBO_CURVES.flatMap((curve) =>
    RCBO_RATINGS.flatMap((rating) =>
      RCBO_SENSITIVITIES_MA.map(
        (ma): ModuleDef => ({
          id: `rcbo-1pn-${curve.toLowerCase()}${rating}-${ma}`,
          kind: 'rcbo',
          name: `RCBO 1P+N ${curve}${rating} ${ma}mA`,
          widthUnits: 2,
          poles: 2,
          ratedCurrentA: rating,
          curve,
          breakingCapacityKA: MCB_BREAKING_CAPACITY_KA,
          residualCurrentMa: ma,
        }),
      ),
    ),
  );
}

function switches(): ModuleDef[] {
  return POLES.flatMap((poles) =>
    SWITCH_RATINGS.map(
      (rating): ModuleDef => ({
        id: `main-switch-${poles}p-${rating}`,
        kind: 'switch',
        name: `Main switch ${poleLabel(poles)} ${rating}A`,
        widthUnits: poles,
        poles,
        ratedCurrentA: rating,
      }),
    ),
  );
}

function surgeProtectors(): ModuleDef[] {
  const variants: Array<[string, string, 1 | 2 | 3 | 4]> = [
    ['1p', '1P', 1],
    ['1pn', '1P+N', 2],
    ['3p', '3P', 3],
    ['3pn', '3P+N', 4],
  ];
  return variants.map(([code, label, poles]) => ({
    id: `spd-t2-${code}`,
    kind: 'spd',
    name: `SPD type 2 ${label}`,
    widthUnits: poles,
    poles,
  }));
}

function contactors(): ModuleDef[] {
  const terminals: TerminalDef[] = [
    { name: 'L1', conductor: 'L1', side: 'top', unit: 0 },
    { name: 'L2', conductor: 'L2', side: 'top', unit: 1 },
    { name: 'L3', conductor: 'L3', side: 'top', unit: 2 },
    { name: 'A1', conductor: 'L', side: 'top', unit: 0 },
    { name: 'A2', conductor: 'N', side: 'top', unit: 2 },
    { name: 'T1', conductor: 'L1', side: 'bottom', unit: 0 },
    { name: 'T2', conductor: 'L2', side: 'bottom', unit: 1 },
    { name: 'T3', conductor: 'L3', side: 'bottom', unit: 2 },
  ];
  return CONTACTOR_RATINGS.map((rating) => ({
    id: `contactor-3p-${rating}-230`,
    kind: 'contactor',
    name: `Contactor 3P ${rating}A, 230V coil`,
    widthUnits: rating > 40 ? 4 : 3,
    poles: 3,
    ratedCurrentA: rating,
    terminals,
  }));
}

function bars(): ModuleDef[] {
  const bar = (id: string, name: string, conductor: 'N' | 'PE', top: string, bottom: string): ModuleDef => ({
    id,
    kind: 'busbar',
    name,
    widthUnits: 6,
    poles: 1,
    resizable: RESIZABLE_BAR,
    terminals: [
      { name: top, conductor, side: 'top', net: conductor, count: 6 },
      { name: bottom, conductor, side: 'bottom', net: conductor, count: 6 },
    ],
  });
  return [
    bar('n-bar-12', 'Neutral bar 12 terminals', 'N', 'N', 'Nb'),
    bar('pe-bar-12', 'Earth bar 12 terminals', 'PE', 'PE', 'PEb'),
  ];
}

function combs(): ModuleDef[] {
  const comb = (id: string, name: string, poles: 1 | 2 | 3 | 4, pattern: Array<'L' | 'L1' | 'L2' | 'L3' | 'N'>): ModuleDef => ({
    id,
    kind: 'comb',
    name,
    widthUnits: 12,
    poles,
    comb: { pattern, side: 'top' },
    resizable: RESIZABLE_COMB,
  });
  return [
    comb('comb-3ph-12', 'Comb 3-phase, 12 units', 3, ['L1', 'L2', 'L3']),
    comb('comb-3phn-12', 'Comb 3-phase + N, 12 units', 4, ['L1', 'L2', 'L3', 'N']),
    comb('comb-1ph-12', 'Comb 1-phase, 12 units', 1, ['L']),
    comb('comb-lpn-12', 'Comb L+N, 12 units', 2, ['L', 'N']),
  ];
}

export function genericModules(): ModuleDef[] {
  return [...breakers(), ...rcds(), ...rcbos(), ...switches(), ...surgeProtectors(), ...contactors(), ...bars(), ...combs()];
}

export function genericEnclosures(): Array<{ id: string; name: string; railLengthsUnits: number[] }> {
  return [1, 2, 3, 4, 5].flatMap((rows) =>
    [12, 18, 24, 36].map((units) => ({
      id: `enc-${rows}x${units}`,
      name: `Enclosure ${rows} ${rows === 1 ? 'row' : 'rows'} x ${units} units`,
      railLengthsUnits: Array<number>(rows).fill(units),
    })),
  );
}

export const GENERIC_LIBRARY_VERSION = '2';
export const GENERIC_LIBRARY_DESCRIPTION =
  'Generic IEC devices from standard rating series. Widths are typical (one 17.5 mm unit per pole) and not taken from any manufacturer; check the datasheet before ordering.';

/** The text of `libraries/generic-iec.json`: one module per line, so diffs stay readable. */
export function genericLibraryText(): string {
  const line = (value: unknown) => `    ${JSON.stringify(value)}`;
  const list = (items: unknown[]) => items.map(line).join(',\n');
  return [
    '{',
    '  "$schema": "./library.schema.json",',
    '  "schemaVersion": 1,',
    `  "id": ${JSON.stringify(GENERIC_LIBRARY_ID)},`,
    '  "name": "Generic IEC modules",',
    `  "version": ${JSON.stringify(GENERIC_LIBRARY_VERSION)},`,
    `  "description": ${JSON.stringify(GENERIC_LIBRARY_DESCRIPTION)},`,
    '  "modules": [',
    list(genericModules()),
    '  ],',
    '  "enclosures": [',
    list(genericEnclosures()),
    '  ]',
    '}',
    '',
  ].join('\n');
}
