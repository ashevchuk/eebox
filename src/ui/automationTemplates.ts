import { unitsFromMm } from '../layout/units';
import { evenPositions } from '../library/terminalLayouts';
import type { Conductor, ModuleDef, Mounting, TerminalDef, TerminalRole, TerminalSide } from '../library/types';
import type { ModuleTemplate } from './moduleTemplates';

type Pin = readonly [name: string, conductor: Conductor];

interface DeviceSpec {
  id: string;
  label: string;
  kind: ModuleDef['kind'];
  widthMm: number;
  heightMm: number;
  mounting: Mounting;
  poles: ModuleDef['poles'];
  top?: readonly Pin[];
  bottom?: readonly Pin[];
}

/** One side of terminals, evenly spread over the width. */
function row(side: TerminalSide, pins: readonly Pin[], widthUnits: number, role?: TerminalRole): TerminalDef[] {
  return evenPositions(pins.length, widthUnits).map((unit, i) => ({ name: pins[i]![0], conductor: pins[i]![1], side, unit, ...(role ? { role } : {}) }));
}

/** Devices that change what they are fed with have an input and an output by design, not by the side of their terminals. */
const DIRECTED_KINDS: readonly ModuleDef['kind'][] = ['softstarter', 'vfd', 'transformer', 'psu'];

/**
 * A device of a size and terminal layout that is typical for its kind, not taken from any maker's
 * catalogue: it is a starting point for the person to correct from the datasheet.
 */
function device(spec: DeviceSpec): ModuleTemplate {
  return {
    id: spec.id,
    label: spec.label,
    build: (id) => {
      const widthUnits = unitsFromMm(spec.widthMm);
      const directed = DIRECTED_KINDS.includes(spec.kind);
      const terminals = [...row('top', spec.top ?? [], widthUnits, directed ? 'input' : undefined), ...row('bottom', spec.bottom ?? [], widthUnits, directed ? 'output' : undefined)];
      return {
        id,
        kind: spec.kind,
        name: 'New module',
        widthUnits,
        heightMm: spec.heightMm,
        mounting: spec.mounting,
        poles: spec.poles,
        ...(terminals.length > 0 ? { terminals } : {}),
      };
    },
  };
}

const PHASES_IN: readonly Pin[] = [['L1', 'L1'], ['L2', 'L2'], ['L3', 'L3']];
const numbered = (prefix: string, count: number, conductor: Conductor): Pin[] =>
  Array.from({ length: count }, (_, i): Pin => [`${prefix}${i + 1}`, conductor]);

const STRIP_WAYS = 12;
/** The width of one feed-through terminal, of a strip for conductors up to 4 mm2, typically. */
const STRIP_WAY_MM = 6;

/** A strip of feed-through terminals: each way is a terminal on the top and one below it, joined inside. */
const terminalStrip: ModuleTemplate = {
  id: 'terminal-strip',
  label: 'Terminal strip, 12 ways',
  build: (id) => {
    const widthUnits = unitsFromMm(STRIP_WAYS * STRIP_WAY_MM);
    const units = evenPositions(STRIP_WAYS, widthUnits);
    const terminals: TerminalDef[] = units.flatMap((unit, i) =>
      (['top', 'bottom'] as const).map((side): TerminalDef => ({ name: String(i + 1), conductor: 'C', side, unit, net: `way${i + 1}` })),
    );
    return { id, kind: 'terminal', name: 'New module', widthUnits, heightMm: 60, mounting: 'rail', poles: 1, terminals };
  },
};

export const AUTOMATION_TEMPLATES: readonly ModuleTemplate[] = [
  device({ id: 'soft-starter', label: 'Soft starter, 3 phases', kind: 'softstarter', widthMm: 120, heightMm: 250, mounting: 'plate', poles: 3, top: PHASES_IN, bottom: [['T1', 'L1'], ['T2', 'L2'], ['T3', 'L3']] }),
  device({ id: 'frequency-drive', label: 'Frequency drive, 3 phases', kind: 'vfd', widthMm: 140, heightMm: 250, mounting: 'plate', poles: 3, top: PHASES_IN, bottom: [['U', 'L1'], ['V', 'L2'], ['W', 'L3']] }),
  device({ id: 'meter-panel-3p', label: 'Meter for a plate, 3 phases and neutral', kind: 'meter', widthMm: 130, heightMm: 180, mounting: 'plate', poles: 4 }),
  device({ id: 'plc', label: 'Controller with 8 inputs and 8 outputs', kind: 'plc', widthMm: 140, heightMm: 100, mounting: 'both', poles: 2, top: [['P', 'DCP'], ['M', 'DCN'], ...numbered('DI', 6, 'C')], bottom: numbered('DO', 8, 'C') }),
  terminalStrip,
  device({
    id: 'analog-inputs',
    label: 'Analog input module, 4 channels',
    kind: 'plc',
    widthMm: 70,
    heightMm: 100,
    mounting: 'both',
    poles: 2,
    top: [['I1P', 'SP'], ['I1N', 'SN'], ['I2P', 'SP'], ['I2N', 'SN'], ['I3P', 'SP'], ['I3N', 'SN'], ['I4P', 'SP'], ['I4N', 'SN'], ['SH', 'SH']],
    bottom: [['P', 'DCP'], ['M', 'DCN']],
  }),
  device({ id: 'transformer-1p', label: 'Control transformer, one phase', kind: 'transformer', widthMm: 100, heightMm: 100, mounting: 'plate', poles: 2, top: [['L', 'L'], ['N', 'N']], bottom: [['S1', 'C'], ['S2', 'C']] }),
  device({ id: 'power-supply-24v-large', label: 'Power supply, 24 V DC, large', kind: 'psu', widthMm: 105, heightMm: 125, mounting: 'both', poles: 2, top: [['L', 'L'], ['N', 'N'], ['PE', 'PE']], bottom: [['P1', 'DCP'], ['P2', 'DCP'], ['M1', 'DCN'], ['M2', 'DCN']] }),
];
