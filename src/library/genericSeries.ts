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
    logic: {
      inputs: { coil: { terminals: ['top:A1', 'top:A2'], when: 'all' } },
      contacts: [1, 2, 3].map((pole) => ({ between: [`top:L${pole}`, `bottom:T${pole}`], closedWhen: 'coil' })),
    },
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

const top = (name: string, conductor: TerminalDef['conductor']): TerminalDef => ({ name, conductor, side: 'top' });
const bottom = (name: string, conductor: TerminalDef['conductor']): TerminalDef => ({ name, conductor, side: 'bottom' });

/** The change-over contact of a relay: common, normally closed, normally open. */
const changeOverContact = (): TerminalDef[] => [bottom('11', 'C'), bottom('12', 'C'), bottom('14', 'C')];

const SWITCHED_LOAD_RATING_A = 16;

/** The relay senses voltage across its top terminals and picks the change-over contact accordingly. */
const monitoringLogic = (sensed: string[]): NonNullable<ModuleDef['logic']> => ({
  inputs: { V: { terminals: sensed.map((name) => `top:${name}`), when: 'all' } },
  contacts: [
    { between: ['bottom:11', 'bottom:14'], closedWhen: 'V' },
    { between: ['bottom:11', 'bottom:12'], closedWhen: '!V' },
  ],
});

/** Monitoring relays measure the supply on their top terminals and switch a contact at the bottom. */
function monitoringRelays(): ModuleDef[] {
  return [
    {
      id: 'vrelay-1p',
      kind: 'relay',
      name: 'Voltage monitoring relay 1P',
      widthUnits: 1,
      poles: 2,
      terminals: [top('L', 'L'), top('N', 'N'), ...changeOverContact()],
      logic: monitoringLogic(['L', 'N']),
    },
    {
      id: 'vrelay-3pn',
      kind: 'relay',
      name: 'Voltage monitoring relay 3P+N',
      widthUnits: 2,
      poles: 4,
      terminals: [top('L1', 'L1'), top('L2', 'L2'), top('L3', 'L3'), top('N', 'N'), ...changeOverContact()],
      logic: monitoringLogic(['L1', 'L2', 'L3', 'N']),
    },
    {
      id: 'phase-relay-3p',
      kind: 'relay',
      name: 'Phase sequence and failure relay 3P',
      widthUnits: 1,
      poles: 3,
      terminals: [top('L1', 'L1'), top('L2', 'L2'), top('L3', 'L3'), ...changeOverContact()],
      logic: monitoringLogic(['L1', 'L2', 'L3']),
    },
    {
      id: 'phase-relay-3pn',
      kind: 'relay',
      name: 'Phase sequence and failure relay 3P+N',
      widthUnits: 1,
      poles: 4,
      terminals: [top('L1', 'L1'), top('L2', 'L2'), top('L3', 'L3'), top('N', 'N'), ...changeOverContact()],
      logic: monitoringLogic(['L1', 'L2', 'L3', 'N']),
    },
  ];
}

type Logic = NonNullable<ModuleDef['logic']>;

/** Switches the phase from `top:L` to `bottom:LO` while the device is supplied and its flag is on. */
const suppliedSwitch = (flag: string, label: string): Logic => ({
  inputs: { V: { terminals: ['top:L', 'top:N'], when: 'all' } },
  flags: { [flag]: { label, default: true } },
  contacts: [{ between: ['top:L', 'bottom:LO'], closedWhen: `${flag} & V` }],
});

/** Lighting relays switch one phase: the load current enters at the top and leaves at the bottom. */
function lightingRelays(): ModuleDef[] {
  return [
    {
      id: 'impulse-relay-1p',
      kind: 'relay',
      name: 'Impulse relay 1P 16 A',
      widthUnits: 1,
      poles: 2,
      ratedCurrentA: SWITCHED_LOAD_RATING_A,
      terminals: [top('1', 'L'), top('A1', 'L'), bottom('2', 'L'), bottom('A2', 'N')],
      logic: { inputs: {}, flags: { on: { label: 'Output on', default: true } }, contacts: [{ between: ['top:1', 'bottom:2'], closedWhen: 'on' }] },
    },
    {
      id: 'stair-timer-1p',
      kind: 'relay',
      name: 'Staircase timer 1P 16 A',
      widthUnits: 1,
      poles: 2,
      ratedCurrentA: SWITCHED_LOAD_RATING_A,
      terminals: [top('L', 'L'), top('P', 'L'), top('N', 'N'), bottom('LO', 'L')],
      logic: suppliedSwitch('running', 'Timer running'),
    },
    {
      id: 'twilight-switch-1p',
      kind: 'relay',
      name: 'Twilight switch 1P 16 A',
      widthUnits: 1,
      poles: 2,
      ratedCurrentA: SWITCHED_LOAD_RATING_A,
      terminals: [top('L', 'L'), top('N', 'N'), top('S1', 'C'), top('S2', 'C'), bottom('LO', 'L')],
      logic: suppliedSwitch('dark', 'Dark'),
    },
    {
      id: 'time-switch-1p',
      kind: 'relay',
      name: 'Daily time switch 1P 16 A',
      widthUnits: 2,
      poles: 2,
      ratedCurrentA: SWITCHED_LOAD_RATING_A,
      terminals: [top('L', 'L'), top('N', 'N'), bottom('LO', 'L')],
      logic: suppliedSwitch('scheduled', 'Schedule on'),
    },
  ];
}

/**
 * Timer relays with one change-over contact. Time is not simulated: the flag says whether the delay
 * has run out, and the person sets it to see the circuit before and after.
 */
function timerRelays(): ModuleDef[] {
  const terminals = [top('A1', 'L'), top('A2', 'N'), bottom('15', 'C'), bottom('16', 'C'), bottom('18', 'C')];
  const supplied: Logic['inputs'] = { V: { terminals: ['top:A1', 'top:A2'], when: 'all' } };
  const changeOver = (energised: string): Logic['contacts'] => [
    { between: ['bottom:15', 'bottom:18'], closedWhen: energised },
    { between: ['bottom:15', 'bottom:16'], closedWhen: `!(${energised})` },
  ];
  return [
    {
      id: 'on-delay-relay',
      kind: 'relay',
      name: 'On-delay timer relay',
      widthUnits: 1,
      poles: 2,
      terminals,
      logic: { inputs: supplied, flags: { elapsed: { label: 'Delay elapsed', default: false } }, contacts: changeOver('V & elapsed') },
    },
    {
      id: 'off-delay-relay',
      kind: 'relay',
      name: 'Off-delay timer relay',
      widthUnits: 1,
      poles: 2,
      terminals,
      logic: { inputs: supplied, flags: { running: { label: 'Delay running', default: false } }, contacts: changeOver('V | running') },
    },
  ];
}

function metersAndSmallDevices(): ModuleDef[] {
  return [
    { id: 'kwh-1p-40', kind: 'meter', name: 'Energy meter 1P 40 A', widthUnits: 2, poles: 2, ratedCurrentA: 40 },
    { id: 'kwh-3p-63', kind: 'meter', name: 'Energy meter 3P+N 63 A', widthUnits: 4, poles: 4, ratedCurrentA: 63 },
    {
      id: 'pilot-light-230',
      kind: 'other',
      name: 'Pilot light 230 V',
      widthUnits: 1,
      poles: 2,
      terminals: [top('L', 'L'), top('N', 'N')],
    },
    {
      id: 'psu-24v-1a',
      kind: 'psu',
      name: 'Power supply 24 V DC, 1 A',
      widthUnits: 2,
      poles: 2,
      terminals: [top('L', 'L'), top('N', 'N'), bottom('24V', 'DCP'), bottom('0V', 'DCN')],
    },
    {
      id: 'psu-24v-2a5',
      kind: 'psu',
      name: 'Power supply 24 V DC, 2.5 A',
      widthUnits: 4,
      poles: 2,
      terminals: [top('L', 'L'), top('N', 'N'), bottom('24V', 'DCP'), bottom('0V', 'DCN')],
    },
    {
      id: 'din-socket-16',
      kind: 'other',
      name: 'DIN rail socket 16 A',
      widthUnits: 3,
      poles: 2,
      ratedCurrentA: SWITCHED_LOAD_RATING_A,
      terminals: [top('L', 'L'), top('N', 'N'), top('PE', 'PE')],
    },
  ];
}

const CHANGEOVER_VARIANTS = [
  { poles: 2, conductors: ['L', 'N'], ratings: [40, 63] },
  { poles: 4, conductors: ['L1', 'L2', 'L3', 'N'], ratings: [63, 100] },
] as const;

/**
 * Manual changeover switches I-0-II for a backup input: two supplies on top, one output at the
 * bottom. Nothing joins the inputs inside the module, so two different sources never end up on one net.
 */
function changeoverSwitches(): ModuleDef[] {
  return CHANGEOVER_VARIANTS.flatMap(({ poles, conductors, ratings }) =>
    ratings.map(
      (rating): ModuleDef => ({
        id: `changeover-${poles}p-${rating}`,
        kind: 'switch',
        name: `Changeover switch I-0-II ${poleLabel(poles)} ${rating}A`,
        widthUnits: poles + 2,
        poles,
        ratedCurrentA: rating,
        terminals: [
          ...conductors.map((c) => top(`${c}a`, c)),
          ...conductors.map((c) => top(`${c}b`, c)),
          ...conductors.map((c) => bottom(c, c)),
        ],
      }),
    ),
  );
}

/** Watches two supplies and gives dry contacts to close the contactor of either and to start a generator. */
function transferController(): ModuleDef[] {
  const sense = (suffix: string) => (['L1', 'L2', 'L3', 'N'] as const).map((c) => top(`${c}${suffix}`, c));
  const contact = (name: string) => [bottom(`${name}1`, 'C'), bottom(`${name}2`, 'C')];
  return [
    {
      id: 'ats-controller-3pn',
      kind: 'relay',
      name: 'Automatic transfer controller 3P+N',
      widthUnits: 4,
      poles: 4,
      terminals: [...sense('a'), ...sense('b'), ...contact('CA'), ...contact('CB'), ...contact('GS')],
      logic: {
        inputs: {
          A: { terminals: ['L1', 'L2', 'L3', 'N'].map((c) => `top:${c}a`), when: 'all' },
          B: { terminals: ['L1', 'L2', 'L3', 'N'].map((c) => `top:${c}b`), when: 'all' },
        },
        contacts: [
          { between: ['bottom:CA1', 'bottom:CA2'], closedWhen: 'A' },
          { between: ['bottom:CB1', 'bottom:CB2'], closedWhen: 'B & !A' },
          { between: ['bottom:GS1', 'bottom:GS2'], closedWhen: '!A' },
        ],
      },
    },
  ];
}

/**
 * Widths that a placed copy of a device may take, because devices of one kind differ between makes.
 * Protective devices keep their width: it follows the number of poles. Contactors place their
 * terminals by position and stay fixed too.
 */
const WIDTH_RANGES: Record<string, readonly [number, number]> = {
  'ats-controller-3pn': [2, 8],
  'time-switch-1p': [1, 4],
  'kwh-1p-40': [1, 4],
  'kwh-3p-63': [3, 8],
  'pilot-light-230': [1, 2],
  'psu-24v-1a': [1, 8],
  'psu-24v-2a5': [2, 8],
  'din-socket-16': [2, 6],
};
const RELAY_WIDTH_RANGE = [1, 4] as const;
const CHANGEOVER_EXTRA_UNITS = 6;

function withWidthRange(def: ModuleDef): ModuleDef {
  if (def.resizable) return def;
  const range =
    WIDTH_RANGES[def.id] ??
    (def.id.startsWith('changeover-') ? ([def.poles, def.poles + CHANGEOVER_EXTRA_UNITS] as const) : undefined) ??
    (def.kind === 'relay' ? RELAY_WIDTH_RANGE : undefined);
  return range ? { ...def, resizable: { minUnits: range[0], maxUnits: range[1] } } : def;
}

export function genericModules(): ModuleDef[] {
  return [
    ...breakers(),
    ...rcds(),
    ...rcbos(),
    ...switches(),
    ...surgeProtectors(),
    ...contactors(),
    ...monitoringRelays(),
    ...lightingRelays(),
    ...timerRelays(),
    ...metersAndSmallDevices(),
    ...changeoverSwitches(),
    ...transferController(),
    ...bars(),
    ...combs(),
  ].map(withWidthRange);
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

export const GENERIC_LIBRARY_VERSION = '6';
export const GENERIC_LIBRARY_DESCRIPTION =
  'Generic IEC devices from standard rating series. Widths are typical (about one 17.5 mm unit per pole for protective devices) and not taken from any manufacturer; check the datasheet before ordering.';

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
