import { moveComb, setCombLabel, setCombWidth } from '../layout/combs';
import { lookupsOf } from '../layout/lookups';
import {
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../layout/limits';
import { moveRail, setRailLabel, setRailLength, setRailPitch } from '../layout/panel';
import {
  movePlacement,
  setPlacementLabel,
  setPlacementWidth,
  type CombPlacement,
  type ModuleRef,
  type Placement,
} from '../layout/placement';
import { terminalsOf } from '../electrical/terminals';
import { CONDUCTORS, type Conductor, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import {
  moveNode,
  renameNode,
  setNodeConductors,
  setWireLabel,
  type SchematicNode,
  type Wire,
} from '../schematic/model';
import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import type { Mode, Selection } from './session';

export type FieldKind = 'text' | 'integer' | 'readonly' | 'choices';

export interface InspectorField {
  key: string;
  label: string;
  kind: FieldKind;
  value: string | number | string[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** For `choices`: everything that can be ticked, in display order. */
  options?: readonly string[];
  hint?: string;
}

export interface InspectorView {
  title: string;
  fields: InspectorField[];
}

type Resolve = (ref: ModuleRef) => ModuleDef | undefined;

export interface InspectContext {
  project: Project;
  selection: Selection;
  mode: Mode;
  resolve: Resolve;
}

export type EditResult =
  | { ok: true; project: Project; selection?: Selection }
  | { ok: false; message: string; needsConfirm?: { message: string } };

type Target =
  | { kind: 'comb'; comb: CombPlacement }
  | { kind: 'placement'; placement: Placement; node?: SchematicNode }
  | { kind: 'rail'; rail: number }
  | { kind: 'wire'; wire: Wire }
  | { kind: 'node'; node: SchematicNode };

const LABEL_MESSAGE = 'Labels are 1 to 60 characters, without line breaks.';
const NOT_A_NUMBER = 'Enter a whole number.';

/** What the selection points at, given which view is showing: a module node stands for its placement. */
function targetOf({ project, selection, mode }: InspectContext): Target | null {
  const { panel, schematic } = project;
  if (mode === 'schematic') {
    const wire = schematic.wires.find((w) => w.id === selection.wireId);
    if (wire) return { kind: 'wire', wire };
    const node = schematic.nodes.find((n) => n.id === selection.nodeId);
    if (!node) return null;
    const placement = node.kind === 'module' ? panel.placements.find((p) => p.id === node.placementId) : undefined;
    return placement ? { kind: 'placement', placement, node } : { kind: 'node', node };
  }
  const comb = panel.combs.find((c) => c.id === selection.combId);
  if (comb) return { kind: 'comb', comb };
  const placement = panel.placements.find((p) => p.id === selection.placementId);
  if (placement) return { kind: 'placement', placement };
  if (selection.rail !== undefined && selection.rail < panel.railLengthsUnits.length) {
    return { kind: 'rail', rail: selection.rail };
  }
  return null;
}

const text = (key: string, label: string, value: string, placeholder?: string): InspectorField => ({
  key, label, kind: 'text', value, ...(placeholder ? { placeholder } : {}),
});
const integer = (key: string, label: string, value: number, min: number, max: number, hint?: string): InspectorField => ({
  key, label, kind: 'integer', value, min, max, ...(hint ? { hint } : {}),
});
const readonly = (key: string, label: string, value: string | number): InspectorField => ({
  key, label, kind: 'readonly', value,
});

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
    integer('slot', 'Position', item.slot, 0, Math.max(0, railLength - width), 'units from the start of the rail'),
    resizable
      ? integer('width', 'Width', width, resizable.minUnits, resizable.maxUnits, `${resizable.minUnits}-${resizable.maxUnits} units`)
      : readonly('width', 'Width', `${width} units`),
  ];
}

export function inspect(ctx: InspectContext): InspectorView | null {
  const target = targetOf(ctx);
  if (!target) return null;
  const { project, resolve } = ctx;
  const { widthOf } = lookupsOf(resolve);

  switch (target.kind) {
    case 'placement': {
      const { placement, node } = target;
      const def = resolve(placement.module);
      const width = widthOf(placement) ?? 1;
      const nodeFields = node
        ? [integer('nodeX', 'Node X', node.x, -100000, 100000), integer('nodeY', 'Node Y', node.y, -100000, 100000)]
        : [];
      return {
        title: node ? 'Module node' : 'Module',
        fields: [
          readonly('module', 'Module', def?.name ?? `${placement.module.moduleId} (missing)`),
          text('label', 'Label', placement.label ?? '', def?.name),
          ...positionFields(placement, def, project, width),
          ...nodeFields,
          ...moduleDetails(def, width),
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
    case 'rail': {
      const { panel } = project;
      const { rail } = target;
      const onRail = panel.placements.filter((p) => p.rail === rail).length;
      const combsOnRail = panel.combs.filter((c) => c.rail === rail).length;
      return {
        title: `Row ${rail + 1}`,
        fields: [
          text('label', 'Label', panel.railLabels[rail] ?? '', `Row ${rail + 1}`),
          integer('position', 'Position', rail + 1, 1, panel.railLengthsUnits.length),
          integer('length', 'Length', panel.railLengthsUnits[rail] ?? 0, 1, MAX_RAIL_LENGTH_UNITS, 'units'),
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
        fields: [
          text('label', 'Label', wire.label ?? ''),
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
        fields: [
          text('label', 'Label', node.label),
          ...(node.conductors
            ? [{ key: 'conductors', label: 'Conductors', kind: 'choices' as const, value: [...node.conductors], options: CONDUCTORS }]
            : [readonly('status', 'Status', 'Its module is not on the panel')]),
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
  'width-out-of-range': 'The width is outside what the library allows.',
  'invalid-label': LABEL_MESSAGE,
  'modules-do-not-fit': 'Modules on this row would not fit.',
  'rail-not-empty': 'Move the modules off the rows you remove first.',
  'invalid-conductors': 'A conductor can be ticked once, and at least one is needed.',
};

function describeError(error: { kind: string; with?: string } | string): string {
  const kind = typeof error === 'string' ? error : error.kind;
  if (kind === 'overlap' && typeof error !== 'string') return `Overlaps ${error.with ?? 'another item'}.`;
  return ERROR_TEXT[kind] ?? 'That change is not possible.';
}

const fail = (message: string): EditResult => ({ ok: false, message });

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
  if (!target) return fail('Nothing is selected.');
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
    case 'placement': {
      const { placement, node } = target;
      if (key === 'label') {
        const result = setPlacementLabel(panel, placement.id, text);
        return result.ok ? withPanel(result.panel) : fail(describeError(result.error));
      }
      if ((key === 'nodeX' || key === 'nodeY') && node) return moveNodeTo(node);
      const value = integerOf(raw);
      if (key === 'row' || key === 'slot') {
        if (value === null) return fail(NOT_A_NUMBER);
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
      const value = integerOf(raw);
      if (key === 'row' || key === 'slot') {
        if (value === null) return fail(NOT_A_NUMBER);
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
    case 'rail': {
      const { rail } = target;
      if (key === 'label') {
        const result = setRailLabel(panel, rail, text);
        return result.ok ? withPanel(result.panel) : fail(LABEL_MESSAGE);
      }
      const value = integerOf(raw);
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

