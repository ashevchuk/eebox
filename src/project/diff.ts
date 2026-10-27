import { INFO_KEYS, INFO_LABELS } from '../layout/info';
import type { CombPlacement, ModuleRef, Placement, ShelfItem } from '../layout/placement';
import type { SchematicNode, TerminalRef, Wire } from '../schematic/model';
import { canonicalJson } from './canonical';
import { moduleKey, type ProjectFile } from './file';

export type ChangeArea = 'project' | 'rows' | 'modules' | 'combs' | 'nodes' | 'wires';
export type ChangeKind = 'added' | 'removed' | 'changed';

export interface Change {
  area: ChangeArea;
  kind: ChangeKind;
  text: string;
}

export const AREA_TITLES: Record<ChangeArea, string> = {
  project: 'Project',
  rows: 'Rows',
  modules: 'Modules on the panel',
  combs: 'Combs',
  nodes: 'Schematic nodes',
  wires: 'Wires',
};

const AREA_ORDER: ChangeArea[] = ['project', 'rows', 'modules', 'combs', 'nodes', 'wires'];
const KIND_ORDER: ChangeKind[] = ['added', 'removed', 'changed'];
const MAX_SHOWN_CHARS = 60;

function show(value: unknown): string {
  if (value === undefined) return 'none';
  const text = typeof value === 'string' ? `"${value}"` : typeof value === 'object' ? canonicalJson(value) : String(value);
  return text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS - 1)}…` : text;
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

const FIELD_NAMES: Record<string, string> = {
  widthUnits: 'width',
  terminalLabels: 'terminal labels',
  crossSectionMm2: 'cross-section',
  lengthM: 'cable length',
  powerW: 'power',
  powerFactor: 'power factor',
  shortCircuitKA: 'short-circuit current',
  loopImpedanceMOhm: 'loop impedance',
  off: 'switched off',
};
const UNITS: Record<string, string> = { widthUnits: ' units', crossSectionMm2: ' mm2', lengthM: ' m', powerW: ' W', shortCircuitKA: ' kA', loopImpedanceMOhm: ' mOhm' };

/** `name before -> after` for every key of two objects whose values differ, except the keys that are told apart some other way. */
function fieldChanges(before: object, after: object, skip: readonly string[], prefix = ''): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !skip.includes(key));
  return keys.flatMap((key) => {
    if (same(a[key], b[key])) return [];
    const name = `${prefix}${FIELD_NAMES[key] ?? key}`;
    const unit = UNITS[key] ?? '';
    const plain = (value: unknown) => (typeof value === 'number' && unit ? `${value}${unit}` : show(value));
    return [`${name} ${plain(a[key])} → ${plain(b[key])}`];
  });
}

const where = (item: { rail?: number; slot?: number }): string => (item.rail === undefined ? 'on the shelf' : `row ${item.rail + 1}, position ${item.slot}`);

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Walks the two lists by id: what only the second has was added, what only the first has was removed, the rest is compared. */
function compareLists<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  area: ChangeArea,
  describe: (item: T) => string,
  changes: (a: T, b: T) => string[],
): Change[] {
  const old = byId(before);
  const next = byId(after);
  const out: Change[] = [];
  for (const item of after) {
    const previous = old.get(item.id);
    if (!previous) out.push({ area, kind: 'added', text: describe(item) });
    else {
      const what = changes(previous, item);
      if (what.length > 0) out.push({ area, kind: 'changed', text: `${describe(item)}: ${what.join('; ')}` });
    }
  }
  for (const item of before) if (!next.has(item.id)) out.push({ area, kind: 'removed', text: describe(item) });
  return out;
}

const moduleName = (file: ProjectFile, ref: ModuleRef): string => file.modules[moduleKey(ref)]?.name ?? ref.moduleId;

export function diffProjects(before: ProjectFile, after: ProjectFile): Change[] {
  const out: Change[] = [];
  const a = before.project.panel;
  const b = after.project.panel;

  if (a.title !== b.title) out.push({ area: 'project', kind: 'changed', text: `title ${show(a.title)} → ${show(b.title)}` });
  for (const key of INFO_KEYS) {
    if (a.info?.[key] !== b.info?.[key]) out.push({ area: 'project', kind: 'changed', text: `${INFO_LABELS[key].toLowerCase()} ${show(a.info?.[key])} → ${show(b.info?.[key])}` });
  }

  const rows = Math.max(a.railLengthsUnits.length, b.railLengthsUnits.length);
  if (a.railLengthsUnits.length !== b.railLengthsUnits.length) out.push({ area: 'rows', kind: 'changed', text: `${a.railLengthsUnits.length} rows → ${b.railLengthsUnits.length} rows` });
  for (let i = 0; i < rows; i++) {
    const [lengthA, lengthB] = [a.railLengthsUnits[i], b.railLengthsUnits[i]];
    if (lengthA !== undefined && lengthB !== undefined && lengthA !== lengthB) out.push({ area: 'rows', kind: 'changed', text: `row ${i + 1}: length ${lengthA} → ${lengthB} units` });
    const [labelA, labelB] = [a.railLabels[i] ?? '', b.railLabels[i] ?? ''];
    if (a.railLabels[i] !== undefined && b.railLabels[i] !== undefined && labelA !== labelB) out.push({ area: 'rows', kind: 'changed', text: `row ${i + 1}: label ${show(labelA || undefined)} → ${show(labelB || undefined)}` });
  }

  const placed = (file: ProjectFile) => [...file.project.panel.placements, ...file.project.panel.shelf.map((s: ShelfItem) => ({ ...s, rail: undefined, slot: undefined }))] as Array<Omit<Placement, 'rail' | 'slot'> & { rail?: number; slot?: number }>;
  out.push(
    ...compareLists(
      placed(before),
      placed(after),
      'modules',
      (p) => `${p.label ? `"${p.label}" ` : ''}${moduleName(after, p.module)} (${p.id}), ${where(p)}`,
      (p, q) => [
        ...(where(p) !== where(q) ? [`moved from ${where(p)} to ${where(q)}`] : []),
        ...(!same(p.module, q.module) ? [`module ${moduleName(before, p.module)} → ${moduleName(after, q.module)}`] : []),
        ...fieldChanges(p, q, ['id', 'module', 'rail', 'slot']),
      ],
    ),
    ...compareLists(
      a.combs,
      b.combs,
      'combs',
      (c: CombPlacement) => `${c.label ? `"${c.label}" ` : ''}${moduleName(after, c.module)} (${c.id}), ${where(c)}`,
      (p, q) => [
        ...(where(p) !== where(q) ? [`moved from ${where(p)} to ${where(q)}`] : []),
        ...(!same(p.module, q.module) ? [`module ${moduleName(before, p.module)} → ${moduleName(after, q.module)}`] : []),
        ...fieldChanges(p, q, ['id', 'module', 'rail', 'slot']),
      ],
    ),
  );

  const nodeName = (file: ProjectFile, id: string): string => {
    const node = file.project.schematic.nodes.find((n) => n.id === id);
    if (!node) return id;
    const placement = node.placementId ? file.project.panel.placements.find((p) => p.id === node.placementId) : undefined;
    return placement?.label ?? node.label;
  };
  out.push(
    ...compareLists(
      before.project.schematic.nodes,
      after.project.schematic.nodes,
      'nodes',
      (n: SchematicNode) => `${n.kind} "${nodeName(after, n.id)}" (${n.id})`,
      (p, q) => [
        ...fieldChanges(p, q, ['id', 'x', 'y', 'load']),
        ...(p.load || q.load ? fieldChanges(p.load ?? {}, q.load ?? {}, [], 'load ') : []),
      ],
    ),
  );

  const end = (file: ProjectFile, ref: TerminalRef) => `${nodeName(file, ref.node)} ${ref.terminal}`;
  out.push(
    ...compareLists(
      before.project.schematic.wires,
      after.project.schematic.wires,
      'wires',
      (w: Wire) => `${w.id}: ${end(after, w.a)} – ${end(after, w.b)}${w.label ? ` "${w.label}"` : ''}`,
      (p, q) => [
        ...(!same(p.a, q.a) || !same(p.b, q.b) ? [`rewired from ${end(before, p.a)} – ${end(before, p.b)} to ${end(after, q.a)} – ${end(after, q.b)}`] : []),
        ...fieldChanges({ ...p, route: undefined }, { ...q, route: undefined }, ['id', 'a', 'b']),
        ...(!same(p.route, q.route) ? ['route changed'] : []),
      ],
    ),
  );

  for (const [key, def] of Object.entries(after.modules)) {
    const was = before.modules[key];
    if (was && !same(was, def)) out.push({ area: 'modules', kind: 'changed', text: `definition of ${def.name} (${key}) differs` });
  }

  return out.sort((x, y) => AREA_ORDER.indexOf(x.area) - AREA_ORDER.indexOf(y.area) || KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));
}

export interface DiffSummary {
  total: number;
  added: number;
  removed: number;
  changed: number;
}

export function summarize(changes: readonly Change[]): DiffSummary {
  const count = (kind: ChangeKind) => changes.filter((c) => c.kind === kind).length;
  return { total: changes.length, added: count('added'), removed: count('removed'), changed: count('changed') };
}
