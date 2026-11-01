import { genericArt } from './genericArt';
import { DIN_MODULE_HEIGHT_MM, MODULE_UNIT_MM, type ModuleDef, type SpdType, type TerminalDef } from './types';

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

/** What the series below describe: modules of the standard height that clip on a rail. */
type DinModule = Omit<ModuleDef, 'heightMm' | 'mounting'>;

const poleLabel = (poles: 1 | 2 | 3 | 4) => `${poles}P`;
const POLES = [1, 2, 3, 4] as const;

function breakers(): DinModule[] {
  return POLES.flatMap((poles) =>
    MCB_CURVES.flatMap((curve) =>
      MCB_RATINGS.map(
        (rating): DinModule => ({
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

function rcds(): DinModule[] {
  return ([2, 4] as const).flatMap((poles) =>
    RCD_RATINGS.flatMap((rating) =>
      RCD_SENSITIVITIES_MA.map(
        (ma): DinModule => ({
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

const RCBO_VARIANTS = [
  { code: '1pn', label: '1P+N', poles: 2, widthUnits: 2 },
  { code: '3pn', label: '3P+N', poles: 4, widthUnits: 4 },
] as const;

function rcbos(): DinModule[] {
  return RCBO_VARIANTS.flatMap(({ code, label, poles, widthUnits }) =>
    RCBO_CURVES.flatMap((curve) =>
      RCBO_RATINGS.flatMap((rating) =>
        RCBO_SENSITIVITIES_MA.map(
          (ma): DinModule => ({
            id: `rcbo-${code}-${curve.toLowerCase()}${rating}-${ma}`,
            kind: 'rcbo',
            name: `RCBO ${label} ${curve}${rating} ${ma}mA`,
            widthUnits,
            poles,
            ratedCurrentA: rating,
            curve,
            breakingCapacityKA: MCB_BREAKING_CAPACITY_KA,
            residualCurrentMa: ma,
          }),
        ),
      ),
    ),
  );
}

/** Feed-through terminals of IEC 60947-7-1: the width of a block in mm and the rated current by conductor cross-section. */
const TERMINAL_SIZES = [
  { sectionMm2: 2.5, widthMm: 5.2, ratedA: 24 },
  { sectionMm2: 4, widthMm: 6.2, ratedA: 32 },
  { sectionMm2: 6, widthMm: 8.2, ratedA: 41 },
  { sectionMm2: 10, widthMm: 10.2, ratedA: 57 },
  { sectionMm2: 16, widthMm: 12.2, ratedA: 76 },
] as const;

/** A terminal block is lower than a protective device. */
const TERMINAL_HEIGHT_MM = 60;

/** The conductor a block carries; `C` is the generic one, for control and signal wiring, which any wire may join. */
const TERMINAL_WAYS: Array<{ code: string; conductor: TerminalDef['conductor']; name: string; label: string }> = [
  { code: 'l', conductor: 'L', name: 'L', label: 'L' },
  { code: 'n', conductor: 'N', name: 'N', label: 'N' },
  { code: 'pe', conductor: 'PE', name: 'PE', label: 'PE' },
  { code: 'c', conductor: 'C', name: '1', label: 'control' },
];

/** Single feed-through terminals, a way each: a terminal on top and one below, joined inside. They stand side by side on the rail. */
function terminalBlocks(): ModuleDef[] {
  return TERMINAL_SIZES.flatMap(({ sectionMm2, widthMm, ratedA }) =>
    TERMINAL_WAYS.map(({ code, conductor, name, label }): ModuleDef => {
      const widthUnits = Math.round((widthMm / MODULE_UNIT_MM) * 1e4) / 1e4;
      const unit = Math.round(((widthUnits - 1) / 2) * 1e4) / 1e4;
      return {
        id: `terminal-${String(sectionMm2).replace('.', '-')}-${code}`,
        kind: 'terminal',
        name: `Feed-through terminal ${sectionMm2} mm2 ${label}`,
        shortName: `${code.toUpperCase()} ${sectionMm2}`,
        widthUnits,
        heightMm: TERMINAL_HEIGHT_MM,
        mounting: 'rail',
        poles: 1,
        ratedCurrentA: ratedA,
        terminals: (['top', 'bottom'] as const).map((side): TerminalDef => ({ name, conductor, side, unit, net: 'way' })),
      };
    }),
  );
}

function switches(): DinModule[] {
  return POLES.flatMap((poles) =>
    SWITCH_RATINGS.map(
      (rating): DinModule => ({
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

/** Terminals of one side spread evenly over the width: the centre of the i-th of n cells. */
const spreadTerminals = (conductors: TerminalDef['conductor'][], side: 'top' | 'bottom', widthUnits: number): TerminalDef[] => {
  const step = widthUnits / conductors.length;
  return conductors.map((conductor, i): TerminalDef => ({ name: conductor, conductor, side, unit: Math.round((i * step + (step - 1) / 2) * 1e4) / 1e4 }));
};

const LINES: Record<'1p' | '1pn' | '3p' | '3pn', { label: string; poles: 1 | 2 | 3 | 4; conductors: TerminalDef['conductor'][] }> = {
  '1p': { label: '1P', poles: 1, conductors: ['L'] },
  '1pn': { label: '1P+N', poles: 2, conductors: ['L', 'N'] },
  '3p': { label: '3P', poles: 3, conductors: ['L1', 'L2', 'L3'] },
  '3pn': { label: '3P+N', poles: 4, conductors: ['L1', 'L2', 'L3', 'N'] },
};

type LineCode = keyof typeof LINES;

interface SpdFamily {
  idPart: string;
  spdType: SpdType;
  name: string;
  widths: Partial<Record<LineCode, number>>;
}

/** The AC families: what the device is made of decides the type, and so how much lightning current it takes. */
const SPD_FAMILIES: SpdFamily[] = [
  { idPart: 't1', spdType: '1', name: 'SPD type 1 (spark gap)', widths: { '1p': 2, '1pn': 4, '3p': 6, '3pn': 8 } },
  { idPart: 't12', spdType: '1+2', name: 'SPD type 1+2 (combined)', widths: { '1p': 2, '1pn': 2, '3p': 4, '3pn': 4 } },
  { idPart: 't2', spdType: '2', name: 'SPD type 2 (varistor)', widths: { '1p': 1, '1pn': 2, '3p': 3, '3pn': 4 } },
  { idPart: 't3', spdType: '3', name: 'SPD type 3 (fine protection)', widths: { '1p': 1, '1pn': 1 } },
];

/** A surge protector shunts the lines to earth: the lines come in on top and the one earth terminal is below, so nothing passes through it. */
function surgeProtectors(): DinModule[] {
  const alternating = SPD_FAMILIES.flatMap((family) =>
    (Object.entries(family.widths) as Array<[LineCode, number]>).map(([code, widthUnits]): DinModule => {
      const { label, poles, conductors } = LINES[code];
      return {
        id: `spd-${family.idPart}-${code}`,
        kind: 'spd',
        name: `${family.name} ${label}`,
        spdType: family.spdType,
        widthUnits,
        poles,
        terminals: [...spreadTerminals(conductors, 'top', widthUnits), { name: 'PE', conductor: 'PE', side: 'bottom', unit: (widthUnits - 1) / 2 }],
      };
    }),
  );
  const direct = ([['t2', '2', 'SPD type 2 (varistor) for DC, PV', 2], ['t12', '1+2', 'SPD type 1+2 (combined) for DC, PV', 4]] as const).map(
    ([idPart, spdType, name, widthUnits]): DinModule => ({
      id: `spd-pv-${idPart}`,
      kind: 'spd',
      name,
      spdType,
      widthUnits,
      poles: 2,
      terminals: [...spreadTerminals(['DCP', 'DCN'], 'top', widthUnits), { name: 'PE', conductor: 'PE', side: 'bottom', unit: (widthUnits - 1) / 2 }],
    }),
  );
  return [...alternating, ...direct];
}

const FUSE_BREAKING_CAPACITY_KA = 100;

/** Cylindrical fuse sizes of IEC 60269-2 for DIN-rail holders: the width of one pole in mm and the ratings of the links. */
const FUSE_SERIES = [
  { size: '10x38' as const, poleMm: 17.5, ratings: [2, 4, 6, 10, 16, 20, 25, 32] },
  { size: '14x51' as const, poleMm: 22.5, ratings: [10, 16, 20, 25, 32, 40, 50] },
  { size: '22x58' as const, poleMm: 36, ratings: [32, 40, 50, 63, 80, 100, 125] },
];

/** Fuse disconnectors with a gG link; the rating of the link is the rating of the module, so the cable checks can use it. */
function fuses(): DinModule[] {
  const lines: Record<1 | 2 | 3 | 4, TerminalDef['conductor'][]> = { 1: ['L'], 2: ['L', 'N'], 3: ['L1', 'L2', 'L3'], 4: ['L1', 'L2', 'L3', 'N'] };
  return FUSE_SERIES.flatMap(({ size, poleMm, ratings }) =>
    POLES.flatMap((poles) =>
      ratings.map((rating): DinModule => {
        const widthUnits = Math.round(((poles * poleMm) / MODULE_UNIT_MM) * 1e4) / 1e4;
        return {
          id: `fuse-${size}-${poles}p-${rating}`,
          kind: 'fuse',
          name: `Fuse disconnector ${size} ${poleLabel(poles)} gG ${rating}A`,
          fuseClass: 'gG',
          fuseSize: size,
          widthUnits,
          poles,
          ratedCurrentA: rating,
          breakingCapacityKA: FUSE_BREAKING_CAPACITY_KA,
          terminals: [...spreadTerminals(lines[poles], 'top', widthUnits), ...spreadTerminals(lines[poles], 'bottom', widthUnits)],
        };
      }),
    ),
  );
}

function contactors(): DinModule[] {
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

function bars(): DinModule[] {
  const bar = (id: string, name: string, conductor: 'N' | 'PE' | 'PEN', top: string, bottom: string): DinModule => ({
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
    bar('pen-bar-12', 'PEN bar 12 terminals', 'PEN', 'PEN', 'PENb'),
    {
      id: 'pen-split-12',
      kind: 'busbar',
      name: 'PEN splitting block',
      widthUnits: 6,
      poles: 1,
      resizable: { minUnits: 6, maxUnits: 24 },
      terminals: [
        { name: 'PEN1', conductor: 'PEN', side: 'top', net: 'PEN', unit: 1 },
        { name: 'PEN2', conductor: 'PEN', side: 'top', net: 'PEN', unit: 4 },
        ...[0, 1, 2].map((unit, i): TerminalDef => ({ name: `N${i + 1}`, conductor: 'N', side: 'bottom', net: 'PEN', unit })),
        ...[3, 4, 5].map((unit, i): TerminalDef => ({ name: `PE${i + 1}`, conductor: 'PE', side: 'bottom', net: 'PEN', unit })),
      ],
    },
  ];
}

function combs(): DinModule[] {
  const comb = (id: string, name: string, poles: 1 | 2 | 3 | 4, pattern: Array<'L' | 'L1' | 'L2' | 'L3' | 'N'>, side: 'top' | 'bottom' = 'top'): DinModule => ({
    id,
    kind: 'comb',
    name,
    widthUnits: 12,
    poles,
    comb: { pattern, side },
    resizable: RESIZABLE_COMB,
  });
  return [
    comb('comb-3ph-12', 'Comb 3-phase, 12 units', 3, ['L1', 'L2', 'L3']),
    comb('comb-3phn-12', 'Comb 3-phase + N, 12 units', 4, ['L1', 'L2', 'L3', 'N']),
    comb('comb-1ph-12', 'Comb 1-phase, 12 units', 1, ['L']),
    comb('comb-lpn-12', 'Comb L+N, 12 units', 2, ['L', 'N']),
    comb('comb-3ph-12-bottom', 'Comb 3-phase, bottom, 12 units', 3, ['L1', 'L2', 'L3'], 'bottom'),
    comb('comb-3phn-12-bottom', 'Comb 3-phase + N, bottom, 12 units', 4, ['L1', 'L2', 'L3', 'N'], 'bottom'),
    comb('comb-1ph-12-bottom', 'Comb 1-phase, bottom, 12 units', 1, ['L'], 'bottom'),
    comb('comb-lpn-12-bottom', 'Comb L+N, bottom, 12 units', 2, ['L', 'N'], 'bottom'),
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
function monitoringRelays(): DinModule[] {
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
function lightingRelays(): DinModule[] {
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
function timerRelays(): DinModule[] {
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

function metersAndSmallDevices(): DinModule[] {
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
function changeoverSwitches(): DinModule[] {
  return CHANGEOVER_VARIANTS.flatMap(({ poles, conductors, ratings }) =>
    ratings.map(
      (rating): DinModule => ({
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
function transferController(): DinModule[] {
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

const onRail = (def: DinModule): ModuleDef => ({ ...def, heightMm: DIN_MODULE_HEIGHT_MM, mounting: 'rail' });

function withWidthRange(def: ModuleDef): ModuleDef {
  if (def.resizable) return def;
  const range =
    WIDTH_RANGES[def.id] ??
    (def.id.startsWith('changeover-') ? ([def.poles, def.poles + CHANGEOVER_EXTRA_UNITS] as const) : undefined) ??
    (def.kind === 'relay' ? RELAY_WIDTH_RANGE : undefined);
  return range ? { ...def, resizable: { minUnits: range[0], maxUnits: range[1] } } : def;
}

function withArt(def: ModuleDef): ModuleDef {
  const art = genericArt(def);
  return art ? { ...def, art } : def;
}

export function genericModules(): ModuleDef[] {
  const onTheRail = [
    ...breakers(),
    ...rcds(),
    ...rcbos(),
    ...switches(),
    ...surgeProtectors(),
    ...fuses(),
    ...contactors(),
    ...monitoringRelays(),
    ...lightingRelays(),
    ...timerRelays(),
    ...metersAndSmallDevices(),
    ...changeoverSwitches(),
    ...transferController(),
    ...bars(),
    ...combs(),
  ].map(onRail);
  return [...onTheRail, ...terminalBlocks()].map(withWidthRange).map(withArt);
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

export const GENERIC_LIBRARY_VERSION = '16';
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
