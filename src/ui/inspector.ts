import { moveComb, setCombLabel, setCombWidth } from '../layout/combs';
import { lookupsOf } from '../layout/lookups';
import {
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../layout/limits';
import {
  moveRail,
  setPanelTitle,
  setRailCount,
  setRailLabel,
  setRailLength,
  setRailPitch,
} from '../layout/panel';
import { takeOff } from '../layout/shelf';
import {
  movePlacement,
  setPlacementLabel,
  setPlacementState,
  setPlacementWidth,
  setTerminalLabel,
  type CombPlacement,
  type ModuleRef,
  type Placement,
} from '../layout/placement';
import { CABLE_TABLE_NOTE, CROSS_SECTIONS_MM2, INSTALL_METHODS, type CableSettings } from '../electrical/cables';
import {
  CIRCUIT_KINDS,
  DEFAULT_INSTALL_METHOD,
  DEFAULT_POWER_FACTOR,
  formatAmps,
  loadReports,
  loadSpecProblem,
  MIN_POWER_FACTOR,
  type LoadSpec,
} from '../electrical/loads';
import { AUTO, energy, positionOf, positionsOf, type Energy } from '../electrical/energy';
import { mmFromUnits } from '../layout/units';
import { terminalsOf } from '../electrical/terminals';
import { moduleDifferences, planModuleUpdate } from '../project/sync';
import { CONDUCTORS, type Conductor, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import {
  moveNode,
  renameNode,
  setNodeConductors,
  setNodeLoad,
  setSourceOff,
  setSourceProtection,
  setWireSection,
  setWireLabel,
  type SchematicNode,
  type Wire,
} from '../schematic/model';
import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import { selectedIds } from './selection';
import type { Mode, Selection } from './session';

export type FieldKind = 'text' | 'integer' | 'number' | 'select' | 'readonly' | 'choices';

export interface InspectorField {
  key: string;
  label: string;
  kind: FieldKind;
  value: string | number | string[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** For `choices` and `select`: what can be ticked or picked, in display order; '' means none. */
  options?: readonly string[];
  hint?: string;
}

/** A button for something that is not the edit of one value, such as taking a module off its rail. */
export interface InspectorAction {
  key: string;
  label: string;
}

export interface InspectorView {
  title: string;
  fields: InspectorField[];
  actions: InspectorAction[];
}

type Resolve = (ref: ModuleRef) => ModuleDef | undefined;

export interface InspectContext {
  project: Project;
  selection: Selection;
  mode: Mode;
  resolve: Resolve;
  /** The module definitions stored with the project. */
  snapshot: Record<string, ModuleDef>;
  /** Module definitions as the libraries have them now, ignoring the stored ones. */
  fromLibraries: Resolve;
  /** Cable table and voltage drop norms; the built-in ones when absent. */
  cableSettings?: CableSettings;
}

export type EditResult =
  | {
      ok: true;
      project: Project;
      selection?: Selection;
      /** Set when the stored module definitions change too. */
      snapshot?: Record<string, ModuleDef>;
      /** Something worth telling the user about what was done. */
      message?: string;
    }
  | { ok: false; message: string; needsConfirm?: { message: string } };

type Target =
  | { kind: 'panel' }
  | { kind: 'comb'; comb: CombPlacement }
  | { kind: 'placement'; placement: Placement; node?: SchematicNode }
  | { kind: 'rail'; rail: number }
  | { kind: 'group'; count: number }
  | { kind: 'wire'; wire: Wire }
  | { kind: 'node'; node: SchematicNode };

const LABEL_MESSAGE = 'Labels are 1 to 60 characters, without line breaks.';
const NOT_A_NUMBER = 'Enter a whole number.';
const NOT_A_DECIMAL = 'Enter a number.';

/** What the selection points at, given which view is showing: a module node stands for its placement. */
function targetOf({ project, selection, mode }: InspectContext): Target {
  const { panel, schematic } = project;
  if (mode === 'schematic') {
    const wire = schematic.wires.find((w) => w.id === selection.wireId);
    if (wire) return { kind: 'wire', wire };
    const node = schematic.nodes.find((n) => n.id === selection.nodeId);
    if (!node) return { kind: 'panel' };
    const placement = node.kind === 'module' ? panel.placements.find((p) => p.id === node.placementId) : undefined;
    return placement ? { kind: 'placement', placement, node } : { kind: 'node', node };
  }
  if (selection.placementIds || selection.combIds) {
    const chosen = selectedIds(selection);
    return { kind: 'group', count: chosen.placements.length + chosen.combs.length };
  }
  const comb = panel.combs.find((c) => c.id === selection.combId);
  if (comb) return { kind: 'comb', comb };
  const placement = panel.placements.find((p) => p.id === selection.placementId);
  if (placement) return { kind: 'placement', placement };
  if (selection.rail !== undefined && selection.rail < panel.railLengthsUnits.length) {
    return { kind: 'rail', rail: selection.rail };
  }
  return { kind: 'panel' };
}

const text = (key: string, label: string, value: string, placeholder?: string): InspectorField => ({
  key, label, kind: 'text', value, ...(placeholder ? { placeholder } : {}),
});
const integer = (key: string, label: string, value: number, min: number, max: number, hint?: string): InspectorField => ({
  key, label, kind: 'integer', value, min, max, ...(hint ? { hint } : {}),
});
/** A number that need not be whole: positions and widths are fractions of a unit. */
const decimal = (key: string, label: string, value: number, min: number, max: number, hint?: string): InspectorField => ({
  key, label, kind: 'number', value, min, max, ...(hint ? { hint } : {}),
});
const readonly = (key: string, label: string, value: string | number): InspectorField => ({
  key, label, kind: 'readonly', value,
});

function loadFields(project: Project, resolve: Resolve, node: SchematicNode, settings?: CableSettings): InspectorField[] {
  if (node.kind === 'source') {
    return [
      { key: 'supply', label: 'Supply', kind: 'select', value: node.off ? 'off' : 'on', options: ['on', 'off'], hint: 'off to see what loses power' },
      { key: 'shortCircuitKA', label: 'Short-circuit', kind: 'number', value: node.shortCircuitKA ?? '', hint: 'kA at the panel; empty for unknown' },
      { key: 'loopImpedanceMOhm', label: 'Loop impedance', kind: 'number', value: node.loopImpedanceMOhm ?? '', hint: 'mOhm phase to neutral; empty for unknown' },
    ];
  }
  if (node.kind !== 'load') return [];
  const spec = node.load;
  const power = energy(project, resolve);
  const fields: InspectorField[] = [
    ...(power.hasSource ? [readonly('supplied', 'Supplied', power.deadNodes.has(node.id) ? 'no' : 'yes')] : []),
    { key: 'powerW', label: 'Power', kind: 'number', value: spec?.powerW ?? '', hint: 'W; empty for none' },
    { key: 'powerFactor', label: 'Power factor', kind: 'number', value: spec?.powerFactor ?? '', min: MIN_POWER_FACTOR, max: 1, hint: `from ${MIN_POWER_FACTOR} to 1; empty for ${DEFAULT_POWER_FACTOR}` },
    { key: 'method', label: 'Cable laying', kind: 'select', value: spec?.method ?? DEFAULT_INSTALL_METHOD, options: INSTALL_METHODS, hint: 'IEC reference method' },
    { key: 'crossSection', label: 'Cable', kind: 'select', value: spec?.crossSectionMm2 === undefined ? '' : String(spec.crossSectionMm2), options: ['', ...CROSS_SECTIONS_MM2.map(String)], hint: 'mm2; empty for not chosen' },
    { key: 'lengthM', label: 'Cable length', kind: 'number', value: spec?.lengthM ?? '', hint: 'm from the panel; empty for unknown' },
    { key: 'circuit', label: 'Circuit', kind: 'select', value: spec?.circuit ?? 'other', options: CIRCUIT_KINDS, hint: 'lighting has a stricter drop limit' },
  ];
  const report = loadReports(project, resolve, settings).find((r) => r.nodeId === node.id);
  if (!report) return fields;
  fields.push(readonly('current', 'Current', `${formatAmps(report.currentA)} A`));
  if (report.breakerA !== undefined) fields.push(readonly('breaker', 'Breaker', `${report.breakerA} A`));
  fields.push(
    readonly('minSection', 'Minimum cable', report.minimumSectionMm2 === undefined ? 'larger than the table covers' : `${report.minimumSectionMm2} mm2`),
  );
  if (report.chosenAmpacityA !== undefined) fields.push(readonly('ampacity', 'Cable carries', `${report.chosenAmpacityA} A`));
  if (report.dropPercent !== undefined) {
    fields.push(readonly('drop', 'Voltage drop', `${report.dropPercent.toFixed(1)} % (limit ${report.dropLimitPercent} %)`));
  }
  fields.push(readonly('cableNote', 'Cable table', CABLE_TABLE_NOTE));
  return fields;
}

/** The position of a switching device, and whether the module carries voltage while the sources are on. */
function powerFields(placement: Placement, def: ModuleDef | undefined, power: Energy): InspectorField[] {
  if (!def) return [];
  const positions = positionsOf(def);
  const fields: InspectorField[] = [];
  if (positions.length > 0) {
    fields.push({
      key: 'state', label: 'Position', kind: 'select', value: positionOf(placement, def) ?? positions[0]!, options: positions,
      hint: positions.includes(AUTO)
        ? 'auto follows the coil, closed and open override it'
        : positions.includes('1') ? '1 or 2 picks the input, open breaks the circuit' : 'open breaks the circuit',
    });
  }
  if (power.hasSource) {
    for (const [name, sensed] of Object.entries(power.inputsOf(placement.id) ?? {})) {
      fields.push(readonly(`input-${name}`, `Input ${name}`, sensed ? 'voltage' : 'no voltage'));
    }
    const contacts = power.contactsOf(placement.id);
    if (contacts) fields.push(readonly('contacts', 'Contacts', `${contacts.closed} of ${contacts.total} closed`));
  }
  if (power.hasSource) fields.push(readonly('supplied', 'Supplied', power.placementLive(placement.id) ? 'yes' : 'no'));
  return fields;
}

function moduleDetails(def: ModuleDef | undefined, widthUnits: number): InspectorField[] {
  if (!def) return [];
  const details: InspectorField[] = [readonly('kind', 'Kind', def.kind), readonly('poles', 'Poles', def.poles)];
  if (def.ratedCurrentA !== undefined) details.push(readonly('rated', 'Rated current', `${def.ratedCurrentA} A`));
  if (def.curve) details.push(readonly('curve', 'Trip curve', def.curve));
  if (def.breakingCapacityKA !== undefined) details.push(readonly('capacity', 'Breaking capacity', `${def.breakingCapacityKA} kA`));
  if (def.residualCurrentMa !== undefined) details.push(readonly('residual', 'Residual current', `${def.residualCurrentMa} mA`));
  if (def.sku) details.push(readonly('sku', 'SKU', def.sku));
  const terminals = terminalsOf(def, widthUnits);
  if (terminals.length > 0) {
    const side = (s: 'top' | 'bottom') => terminals.filter((t) => t.side === s).map((t) => t.name);
    const describeSide = (names: string[]) => (names.length > 8 ? `${names.length}` : names.join(' '));
    details.push(readonly('terminals', 'Terminals', `top ${describeSide(side('top'))} · bottom ${describeSide(side('bottom'))}`));
  }
  return details;
}

function positionFields(
  item: Placement | CombPlacement,
  def: ModuleDef | undefined,
  project: Project,
  width: number,
): InspectorField[] {
  const rails = project.panel.railLengthsUnits;
  const railLength = rails[item.rail] ?? 0;
  const resizable = def?.resizable;
  return [
    integer('row', 'Row', item.rail + 1, 1, Math.max(1, rails.length)),
    decimal('slot', 'Position', item.slot, 0, Math.max(0, railLength - width), `units from the start of the rail, ${mmFromUnits(item.slot)} mm`),
    resizable
      ? decimal('width', 'Width', width, resizable.minUnits, resizable.maxUnits, `${resizable.minUnits}-${resizable.maxUnits} units, ${mmFromUnits(width)} mm`)
      : readonly('width', 'Width', `${width} units (${mmFromUnits(width)} mm)`),
  ];
}

function terminalLabelFields(placement: Placement, def: ModuleDef | undefined, width: number): InspectorField[] {
  if (!def) return [];
  return terminalsOf(def, width).map((t) =>
    text(`terminal:${t.id}`, `${t.name} (${t.side})`, placement.terminalLabels?.[t.id] ?? '', t.name),
  );
}

const TAKE_OFF: InspectorAction = { key: 'takeOff', label: 'Take off the rail' };
export const EDIT_MODULE_ACTION = 'editModule';
const EDIT_MODULE: InspectorAction = { key: EDIT_MODULE_ACTION, label: 'Edit module…' };

export function inspect(ctx: InspectContext): InspectorView {
  const target = targetOf(ctx);
  const { project, resolve } = ctx;
  const { widthOf } = lookupsOf(resolve);

  switch (target.kind) {
    case 'panel': {
      const { panel } = project;
      const longest = Math.max(0, ...panel.railLengthsUnits);
      const { changed, missing } = moduleDifferences(project, ctx.snapshot, ctx.fromLibraries);
      const differences = [
        changed.length > 0 ? `${changed.length} differ from the libraries` : '',
        missing.length > 0 ? `${missing.length} no longer in any library` : '',
      ].filter(Boolean);
      return {
        title: 'Panel',
        actions: changed.length > 0 ? [{ key: 'updateModules', label: 'Update modules from libraries' }] : [],
        fields: [
          text('title', 'Title', panel.title ?? '', 'Untitled panel'),
          integer('rows', 'Rows', panel.railLengthsUnits.length, 1, MAX_RAILS, 'a row must be empty to be removed'),
          readonly('size', 'Size', `longest row ${longest} units`),
          readonly(
            'contents',
            'Contents',
            `${panel.placements.length} modules, ${panel.combs.length} combs, ${panel.shelf.length} on the shelf`,
          ),
          readonly('libraries', 'Module data', differences.length > 0 ? differences.join(', ') : 'matches the libraries'),
        ],
      };
    }
    case 'placement': {
      const { placement, node } = target;
      const def = resolve(placement.module);
      const width = widthOf(placement) ?? 1;
      const nodeFields = node
        ? [integer('nodeX', 'Node X', node.x, -100000, 100000), integer('nodeY', 'Node Y', node.y, -100000, 100000)]
        : [];
      return {
        title: node ? 'Module node' : 'Module',
        actions: def ? [EDIT_MODULE, TAKE_OFF] : [TAKE_OFF],
        fields: [
          readonly('module', 'Module', def?.name ?? `${placement.module.moduleId} (missing)`),
          text('label', 'Label', placement.label ?? '', def?.name),
          ...positionFields(placement, def, project, width),
          ...powerFields(placement, def, energy(project, resolve)),
          ...nodeFields,
          ...moduleDetails(def, width),
          ...terminalLabelFields(placement, def, width),
          readonly('id', 'Id', placement.id),
        ],
      };
    }
    case 'comb': {
      const { comb } = target;
      const def = resolve(comb.module);
      const width = widthOf(comb) ?? 1;
      return {
        title: 'Comb',
        actions: [],
        fields: [
          readonly('module', 'Module', def?.name ?? `${comb.module.moduleId} (missing)`),
          text('label', 'Label', comb.label ?? '', def?.name),
          ...positionFields(comb, def, project, width),
          ...(def?.comb
            ? [readonly('pattern', 'Pins', def.comb.pattern.join(' ')), readonly('side', 'Side', def.comb.side)]
            : []),
          readonly('id', 'Id', comb.id),
        ],
      };
    }
    case 'group':
      return {
        title: `${target.count} items selected`,
        fields: [readonly('count', 'Selected', target.count)],
        actions: [],
      };
    case 'rail': {
      const { panel } = project;
      const { rail } = target;
      const onRail = panel.placements.filter((p) => p.rail === rail).length;
      const combsOnRail = panel.combs.filter((c) => c.rail === rail).length;
      return {
        title: `Row ${rail + 1}`,
        actions: [],
        fields: [
          text('label', 'Label', panel.railLabels[rail] ?? '', `Row ${rail + 1}`),
          integer('position', 'Position', rail + 1, 1, panel.railLengthsUnits.length),
          decimal('length', 'Length', panel.railLengthsUnits[rail] ?? 0, 1, MAX_RAIL_LENGTH_UNITS, `units, ${mmFromUnits(panel.railLengthsUnits[rail] ?? 0)} mm`),
          ...(rail < panel.railPitchesMm.length
            ? [integer('spacing', 'Spacing below', panel.railPitchesMm[rail] ?? 0, MIN_RAIL_PITCH_MM, MAX_RAIL_PITCH_MM, 'mm to the next row')]
            : []),
          readonly('contents', 'Contents', `${onRail} module${onRail === 1 ? '' : 's'}, ${combsOnRail} comb${combsOnRail === 1 ? '' : 's'}`),
        ],
      };
    }
    case 'wire': {
      const { wire } = target;
      const { schematic } = project;
      const end = (ref: Wire['a']) => {
        const node = schematic.nodes.find((n) => n.id === ref.node);
        const placement = node?.kind === 'module' ? project.panel.placements.find((p) => p.id === node.placementId) : undefined;
        return `${placement?.label ?? node?.label ?? ref.node} · ${ref.terminal.replace(':', ' ')}`;
      };
      const terminals = nodeTerminalsLookup(project.panel, resolve);
      const first = schematic.nodes.find((n) => n.id === wire.a.node);
      const conductor = first && terminals(first)?.find((t) => t.id === wire.a.terminal)?.conductor;
      return {
        title: 'Wire',
        actions: [],
        fields: [
          text('label', 'Label', wire.label ?? ''),
          { key: 'section', label: 'Cross-section', kind: 'select', value: wire.crossSectionMm2 === undefined ? '' : String(wire.crossSectionMm2), options: ['', ...CROSS_SECTIONS_MM2.map(String)], hint: 'mm2, for the ferrules; empty for the load cable' },
          readonly('from', 'From', end(wire.a)),
          readonly('to', 'To', end(wire.b)),
          ...(conductor ? [readonly('conductor', 'Conductor', conductor)] : []),
          readonly('id', 'Id', wire.id),
        ],
      };
    }
    case 'node': {
      const { node } = target;
      return {
        title: node.kind === 'source' ? 'Source' : node.kind === 'load' ? 'Load' : 'Module node',
        actions: [],
        fields: [
          text('label', 'Label', node.label),
          ...(node.conductors
            ? [{ key: 'conductors', label: 'Conductors', kind: 'choices' as const, value: [...node.conductors], options: CONDUCTORS }]
            : [readonly('status', 'Status', 'Its module is not on the panel')]),
          ...loadFields(ctx.project, ctx.resolve, node, ctx.cableSettings),
          integer('nodeX', 'X', node.x, -100000, 100000),
          integer('nodeY', 'Y', node.y, -100000, 100000),
          readonly('id', 'Id', node.id),
        ],
      };
    }
  }
}

const ERROR_TEXT: Record<string, string> = {
  'out-of-rail': 'Does not fit on the rail.',
  'unknown-rail': 'There is no such row.',
  'unknown-module': 'The module is missing from the libraries.',
  'not-resizable': 'This module cannot be resized.',
  'invalid-state': 'That position is not one this device has.',
  'width-out-of-range': 'The width is outside what the library allows.',
  'invalid-label': LABEL_MESSAGE,
  'modules-do-not-fit': 'Modules on this row would not fit.',
  'rail-not-empty': 'Move the modules off the rows you remove first.',
  'invalid-conductors': 'A conductor can be ticked once, and at least one is needed.',
  'not-a-load': 'Only a load has a power.',
  'not-a-source': 'Only a source can be switched off.',
  'invalid-load': 'The load data is out of range.',
  'invalid-section': 'That cross-section is not in the table.',
};

function describeError(error: { kind: string; with?: string } | string): string {
  const kind = typeof error === 'string' ? error : error.kind;
  if (kind === 'overlap' && typeof error !== 'string') return `Overlaps ${error.with ?? 'another item'}.`;
  return ERROR_TEXT[kind] ?? 'That change is not possible.';
}

const fail = (message: string): EditResult => ({ ok: false, message });

const LOAD_KEYS = ['powerW', 'powerFactor', 'method', 'crossSection', 'lengthM', 'circuit'];
const TEXT_LOAD_KEYS = ['method', 'circuit'];

const LOAD_FIELD_OF_KEY: Record<string, keyof LoadSpec> = {
  powerW: 'powerW',
  powerFactor: 'powerFactor',
  method: 'method',
  crossSection: 'crossSectionMm2',
  lengthM: 'lengthM',
  circuit: 'circuit',
};

/** The load after one field was edited, undefined when the power was cleared, or a message when the text is no good. */
function loadAfterEdit(current: LoadSpec | undefined, key: string, text: string): LoadSpec | undefined | string {
  const trimmed = text.trim();
  if (key === 'powerW' && trimmed === '') return undefined;
  if (key !== 'powerW' && !current) return 'Enter the power first.';
  const number = Number(trimmed);
  if (trimmed !== '' && !TEXT_LOAD_KEYS.includes(key) && !Number.isFinite(number)) return 'Enter a number.';
  const fields: Record<string, number | string | undefined> = { ...current };
  fields[LOAD_FIELD_OF_KEY[key]!] = trimmed === '' ? undefined : TEXT_LOAD_KEYS.includes(key) ? trimmed : number;
  return withValidation(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as unknown as LoadSpec);
}

function withValidation(spec: LoadSpec): LoadSpec | string {
  const problem = loadSpecProblem(spec);
  return problem === null ? spec : `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`;
}

function numberOf(raw: string | string[]): number | null {
  if (Array.isArray(raw) || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function integerOf(raw: string | string[]): number | null {
  if (Array.isArray(raw) || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

/** Wires that hang on terminals a placed copy loses when it gets a new width. */
function wiresLostByWidth(project: Project, resolve: Resolve, placement: Placement, widthUnits: number): string[] {
  const def = resolve(placement.module);
  if (!def) return [];
  const kept = new Set(terminalsOf(def, widthUnits).map((t) => t.id));
  const nodeIds = new Set(project.schematic.nodes.filter((n) => n.placementId === placement.id).map((n) => n.id));
  const lost = (ref: Wire['a']) => nodeIds.has(ref.node) && !kept.has(ref.terminal);
  return project.schematic.wires.filter((w) => lost(w.a) || lost(w.b)).map((w) => w.id);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Applies one edited field. Changes that would remove wires ask for confirmation first. */
export function applyEdit(
  ctx: InspectContext,
  key: string,
  raw: string | string[],
  options: { confirmed?: boolean } = {},
): EditResult {
  const target = targetOf(ctx);
  const { project, resolve } = ctx;
  const { panel, schematic } = project;
  const { widthOf, resizeOf, combLookup } = lookupsOf(resolve);
  const withPanel = (next: typeof panel): EditResult => ({ ok: true, project: { ...project, panel: next } });
  const withSchematic = (next: typeof schematic): EditResult => ({ ok: true, project: { ...project, schematic: next } });
  const text = typeof raw === 'string' ? raw : '';

  const moveNodeTo = (node: SchematicNode): EditResult => {
    const value = integerOf(raw);
    if (value === null) return fail(NOT_A_NUMBER);
    const result = moveNode(schematic, node.id, key === 'nodeX' ? value : node.x, key === 'nodeY' ? value : node.y);
    return result.ok ? withSchematic(result.schematic) : fail(describeError(result.error));
  };

  switch (target.kind) {
    case 'panel': {
      if (key === 'title') {
        const result = setPanelTitle(panel, text);
        return result.ok ? withPanel(result.panel) : fail(LABEL_MESSAGE);
      }
      if (key === 'rows') {
        const value = integerOf(raw);
        if (value === null) return fail(NOT_A_NUMBER);
        const result = setRailCount(panel, value);
        return result.ok ? withPanel(result.panel) : fail(result.error === 'invalid-value' ? `Rows: 1 to ${MAX_RAILS}.` : describeError(result.error));
      }
      return fail('That property cannot be edited.');
    }
    case 'placement': {
      const { placement, node } = target;
      if (key === 'label') {
        const result = setPlacementLabel(panel, placement.id, text);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if (key === 'state') {
        const def = resolve(placement.module);
        const result = setPlacementState(panel, placement.id, text, def ? positionsOf(def) : []);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if (key.startsWith('terminal:')) {
        const result = setTerminalLabel(panel, placement.id, key.slice('terminal:'.length), text);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if ((key === 'nodeX' || key === 'nodeY') && node) return moveNodeTo(node);
      const value = key === 'slot' || key === 'width' ? numberOf(raw) : integerOf(raw);
      if (key === 'row' || key === 'slot') {
        if (value === null) return fail(key === 'row' ? NOT_A_NUMBER : NOT_A_DECIMAL);
        const result = movePlacement(
          panel,
          widthOf,
          placement.id,
          key === 'row' ? value - 1 : placement.rail,
          key === 'slot' ? value : placement.slot,
        );
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if (key === 'width') {
        if (value === null) return fail(NOT_A_NUMBER);
        const result = setPlacementWidth(panel, widthOf, resizeOf, placement.id, value);
        if (!result.ok) return fail(describeError(result.error));
        const lost = wiresLostByWidth(project, resolve, placement, value);
        if (lost.length > 0 && !options.confirmed) {
          return { ok: false, message: '', needsConfirm: { message: `This width removes ${plural(lost.length, 'wire')} from terminals that disappear. Continue?` } };
        }
        const wires = schematic.wires.filter((w) => !lost.includes(w.id));
        return { ok: true, project: { panel: result.panel, schematic: { ...schematic, wires } } };
      }
      return fail('That property cannot be edited.');
    }
    case 'comb': {
      const { comb } = target;
      if (key === 'label') {
        const result = setCombLabel(panel, comb.id, text);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      const value = key === 'slot' || key === 'width' ? numberOf(raw) : integerOf(raw);
      if (key === 'row' || key === 'slot') {
        if (value === null) return fail(key === 'row' ? NOT_A_NUMBER : NOT_A_DECIMAL);
        const result = moveComb(
          panel,
          combLookup,
          comb.id,
          key === 'row' ? value - 1 : comb.rail,
          key === 'slot' ? value : comb.slot,
        );
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if (key === 'width') {
        if (value === null) return fail(NOT_A_NUMBER);
        const result = setCombWidth(panel, combLookup, resizeOf, comb.id, value);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      return fail('That property cannot be edited.');
    }
    case 'group':
      return fail('That property cannot be edited.');
    case 'rail': {
      const { rail } = target;
      if (key === 'label') {
        const result = setRailLabel(panel, rail, text);
        return result.ok ? withPanel(result.panel) : fail(LABEL_MESSAGE);
      }
      const value = key === 'length' ? numberOf(raw) : integerOf(raw);
      if (value === null) return fail(NOT_A_NUMBER);
      if (key === 'position') {
        const result = moveRail(panel, rail, value - 1);
        return result.ok ? { ok: true, project: { ...project, panel: result.panel }, selection: { rail: value - 1 } } : fail('There is no such row.');
      }
      if (key === 'length') {
        const result = setRailLength(panel, widthOf, rail, value);
        return result.ok ? withPanel(result.panel) : fail(result.error === 'invalid-value' ? `Length is 1 to ${MAX_RAIL_LENGTH_UNITS} units.` : describeError(result.error));
      }
      if (key === 'spacing') {
        const result = setRailPitch(panel, rail, value);
        return result.ok ? withPanel(result.panel) : fail(`Spacing is ${MIN_RAIL_PITCH_MM} to ${MAX_RAIL_PITCH_MM} mm.`);
      }
      return fail('That property cannot be edited.');
    }
    case 'wire': {
      if (key === 'section') {
        const section = text.trim() === '' ? undefined : Number(text);
        const result = setWireSection(schematic, target.wire.id, section);
        return result.ok ? withSchematic(result.schematic) : fail(describeError(result.error));
      }
      if (key !== 'label') return fail('That property cannot be edited.');
      const result = setWireLabel(schematic, target.wire.id, text);
      return result.ok ? withSchematic(result.schematic) : fail(describeError(result.error));
    }
    case 'node': {
      const { node } = target;
      if (key === 'label') {
        const result = renameNode(schematic, node.id, text);
        return result.ok ? withSchematic(result.schematic) : fail(text.trim() === '' ? 'This item needs a label.' : LABEL_MESSAGE);
      }
      if (key === 'nodeX' || key === 'nodeY') return moveNodeTo(node);
      if ((key === 'shortCircuitKA' || key === 'loopImpedanceMOhm') && node.kind === 'source') {
        const value = text.trim() === '' ? undefined : Number(text);
        if (value !== undefined && !Number.isFinite(value)) return fail(NOT_A_DECIMAL);
        const result = setSourceProtection(schematic, node.id, key, value);
        return result.ok ? withSchematic(result.schematic) : fail('Enter a value above 0 within the allowed range.');
      }
      if (key === 'supply' && node.kind === 'source') {
        const result = setSourceOff(schematic, node.id, text === 'off');
        return result.ok ? withSchematic(result.schematic) : fail(describeError(result.error));
      }
      if (node.kind === 'load' && LOAD_KEYS.includes(key)) {
        const next = loadAfterEdit(node.load, key, text);
        if (typeof next === 'string') return fail(next);
        const result = setNodeLoad(schematic, node.id, next);
        return result.ok ? withSchematic(result.schematic) : fail(describeError(result.error));
      }
      if (key === 'conductors' && Array.isArray(raw)) {
        const result = setNodeConductors(schematic, node.id, raw as Conductor[]);
        if (!result.ok) return fail(describeError(result.error));
        if (result.droppedWires > 0 && !options.confirmed) {
          return { ok: false, message: '', needsConfirm: { message: `This removes ${plural(result.droppedWires, 'wire')} from conductors that go away. Continue?` } };
        }
        return withSchematic(result.schematic);
      }
      return fail('That property cannot be edited.');
    }
  }
}


/** Runs an inspector action; returns the project to commit and what should be selected afterwards. */
export function applyAction(ctx: InspectContext, key: string, options: { confirmed?: boolean } = {}): EditResult {
  const target = targetOf(ctx);
  if (key === 'takeOff' && target.kind === 'placement') {
    const result = takeOff(ctx.project.panel, target.placement.id);
    if (!result.ok) return fail('That module is no longer on the rail.');
    return {
      ok: true,
      project: { ...ctx.project, panel: result.panel },
      selection: target.node ? { nodeId: target.node.id } : {},
    };
  }
  if (key === 'updateModules' && target.kind === 'panel') {
    const plan = planModuleUpdate(ctx.project, ctx.snapshot, ctx.fromLibraries);
    if (plan.changed.length === 0) return fail('The modules already match the libraries.');
    const effects = [
      plan.droppedWires > 0 ? `removes ${plural(plan.droppedWires, 'wire')} from terminals that no longer exist` : '',
      plan.newProblems.length > 0 ? `causes ${plural(plan.newProblems.length, 'problem')}: ${plan.newProblems.slice(0, 3).join('; ')}` : '',
    ].filter(Boolean);
    if (effects.length > 0 && !options.confirmed) {
      const names = plan.changed.slice(0, 3).map((c) => c.name).join(', ');
      return { ok: false, message: '', needsConfirm: { message: `Updating ${plural(plan.changed.length, 'module')} (${names}) ${effects.join(' and ')}. Continue?` } };
    }
    return {
      ok: true,
      project: plan.project,
      snapshot: plan.snapshot,
      message: `Updated ${plural(plan.changed.length, 'module')} from the libraries.`,
    };
  }
  return fail('That action is not available here.');
}
