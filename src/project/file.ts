import { annotationsCheck, type Annotation } from '../layout/annotations';
import { infoCheck, type ProjectInfo } from '../layout/info';
import { findConnectionProblems, findGlue } from '../electrical/problems';
import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import { CROSS_SECTIONS_MM2, INSTALL_METHODS, type CableSettings } from '../electrical/cables';
import { EARTHING_SYSTEM_IDS } from '../electrical/earthing';
import { CIRCUIT_KINDS, loadSpecProblem, MAX_CABLE_LENGTH_M, MAX_POWER_W, MIN_POWER_FACTOR } from '../electrical/loads';
import { findRuleWarnings, ownerName } from '../electrical/rules';
import {
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../layout/limits';
import { findCombProblems } from '../layout/combs';
import {
  findProblems as findPanelProblems,
  type CombPlacement,
  type ModuleRef,
  type Placement,
  type ShelfItem,
} from '../layout/placement';
import {
  MODULE_SPEC,
  validateModuleDeep,
  identifier,
  isRecord,
  nonEmptyString,
  labelCheck,
  oneOf,
  widthCheck,
  railLengthsCheck,
  validateList,
  validateObject,
  type FieldSpec,
  type ValidationError,
} from '../library/validate';
import { CONDUCTORS, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { MAX_LOOP_IMPEDANCE_MOHM, MAX_SHORT_CIRCUIT_KA, routeProblem, findProblems as findSchematicProblems, type SchematicNode, type Wire } from '../schematic/model';

export const PROJECT_FORMAT = 'eebox-project';
export const PROJECT_VERSION = 1;
const NODE_KINDS = ['source', 'load', 'module'] as const;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  project: Project;
  /** Definitions of the placed modules at save time, keyed by `libraryId/moduleId`. */
  modules: Record<string, ModuleDef>;
}

export type ProjectParseResult =
  | { ok: true; file: ProjectFile; warnings: string[] }
  | { ok: false; errors: ValidationError[] };

export const moduleKey = (ref: ModuleRef): string => `${ref.libraryId}/${ref.moduleId}`;

export function buildProjectFile(
  project: Project,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
): ProjectFile {
  const modules: Record<string, ModuleDef> = {};
  for (const { module } of [...project.panel.placements, ...project.panel.combs]) {
    const def = resolve(module);
    if (def) modules[moduleKey(module)] = def;
  }
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, project, modules };
}

const objectCheck = (v: unknown) => (isRecord(v) ? null : 'must be an object');
const arrayCheck = (v: unknown) => (Array.isArray(v) ? null : 'must be an array');
const nonNegativeInteger = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 ? null : 'must be a non-negative integer';
const slotCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_LENGTH_UNITS ? null : `must be a number of units from 0 to ${MAX_RAIL_LENGTH_UNITS}`;
const unitsCheck = widthCheck;
const finiteNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a finite number');
const pitchListCheck = (v: unknown) =>
  Array.isArray(v) &&
  v.length < MAX_RAILS &&
  v.every((n) => Number.isInteger(n) && n >= MIN_RAIL_PITCH_MM && n <= MAX_RAIL_PITCH_MM)
    ? null
    : `must be an array of whole numbers from ${MIN_RAIL_PITCH_MM} to ${MAX_RAIL_PITCH_MM} (mm)`;
const terminalRefCheck = (v: unknown) =>
  isRecord(v) && Object.keys(v).length === 2 && nonEmptyString(v.node) === null && nonEmptyString(v.terminal) === null
    ? null
    : 'must be an object with node and terminal';
const conductorsCheck = (v: unknown) =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= CONDUCTORS.length &&
  new Set(v).size === v.length &&
  v.every((c) => (CONDUCTORS as readonly unknown[]).includes(c))
    ? null
    : `must list each of 1 to ${CONDUCTORS.length} conductors once, out of: ${CONDUCTORS.join(', ')}`;
const railLabelsCheck = (v: unknown) =>
  Array.isArray(v) && v.length <= MAX_RAILS && v.every((l) => l === '' || labelCheck(l) === null)
    ? null
    : 'must be a list with one entry per rail, each empty or a valid label';
const MAX_TERMINAL_LABELS = 64;
const terminalLabelsCheck = (v: unknown) =>
  isRecord(v) &&
  Object.keys(v).length >= 1 &&
  Object.keys(v).length <= MAX_TERMINAL_LABELS &&
  Object.entries(v).every(([id, label]) => id.length > 0 && id.length <= 40 && labelCheck(label) === null)
    ? null
    : `must map terminal ids to valid labels, at most ${MAX_TERMINAL_LABELS}`;
const moduleRefCheck = (v: unknown) =>
  isRecord(v) &&
  Object.keys(v).length === 2 &&
  nonEmptyString(v.libraryId) === null &&
  nonEmptyString(v.moduleId) === null
    ? null
    : 'must be an object with libraryId and moduleId';

const ROOT_SPEC: FieldSpec = {
  format: { required: true, check: (v) => (v === PROJECT_FORMAT ? null : `must be "${PROJECT_FORMAT}"`) },
  version: {
    required: true,
    check: (v) => (v === PROJECT_VERSION ? null : `unsupported version, this build reads ${PROJECT_VERSION}`),
  },
  project: { required: true, check: objectCheck },
  modules: { required: true, check: objectCheck },
};
const PROJECT_SPEC: FieldSpec = {
  panel: { required: true, check: objectCheck },
  schematic: { required: true, check: objectCheck },
};
const PANEL_SPEC: FieldSpec = {
  title: { required: false, check: labelCheck },
  info: { required: false, check: infoCheck },
  annotations: { required: false, check: annotationsCheck },
  railLengthsUnits: { required: true, check: railLengthsCheck },
  railPitchesMm: { required: true, check: pitchListCheck },
  railLabels: { required: true, check: railLabelsCheck },
  placements: { required: true, check: arrayCheck },
  combs: { required: true, check: arrayCheck },
  shelf: { required: true, check: arrayCheck },
};
const COMB_PLACEMENT_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  module: { required: true, check: moduleRefCheck },
  rail: { required: true, check: nonNegativeInteger },
  slot: { required: true, check: slotCheck },
  label: { required: false, check: labelCheck },
  widthUnits: { required: false, check: unitsCheck },
};
const STATES = ['auto', 'closed', 'open', '1', '2'] as const;
const MAX_FLAGS = 8;
const flagsCheck = (v: unknown) =>
  isRecord(v) &&
  Object.keys(v).length >= 1 &&
  Object.keys(v).length <= MAX_FLAGS &&
  Object.entries(v).every(([name, value]) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && typeof value === 'boolean')
    ? null
    : `must map flag names to true or false, at most ${MAX_FLAGS}`;
const SHELF_ITEM_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  module: { required: true, check: moduleRefCheck },
  label: { required: false, check: labelCheck },
  widthUnits: { required: false, check: unitsCheck },
  terminalLabels: { required: false, check: terminalLabelsCheck },
  state: { required: false, check: oneOf(STATES) },
  flags: { required: false, check: flagsCheck },
};
const PLACEMENT_SPEC: FieldSpec = {
  ...COMB_PLACEMENT_SPEC,
  terminalLabels: { required: false, check: terminalLabelsCheck },
  state: { required: false, check: oneOf(STATES) },
  flags: { required: false, check: flagsCheck },
};
const SCHEMATIC_SPEC: FieldSpec = {
  nodes: { required: true, check: arrayCheck },
  wires: { required: true, check: arrayCheck },
  annotations: { required: false, check: annotationsCheck },
};
const NODE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  kind: { required: true, check: oneOf(NODE_KINDS) },
  label: { required: true, check: labelCheck },
  x: { required: true, check: finiteNumber },
  y: { required: true, check: finiteNumber },
  placementId: { required: false, check: identifier },
  conductors: { required: false, check: conductorsCheck },
  load: { required: false, check: objectCheck },
  off: { required: false, check: (v) => (v === true ? null : 'must be true when present') },
  earthing: { required: false, check: oneOf(EARTHING_SYSTEM_IDS) },
  shortCircuitKA: { required: false, check: (v) => (typeof v === 'number' && v > 0 && v <= MAX_SHORT_CIRCUIT_KA ? null : `must be above 0 and at most ${MAX_SHORT_CIRCUIT_KA}`) },
  loopImpedanceMOhm: { required: false, check: (v) => (typeof v === 'number' && v > 0 && v <= MAX_LOOP_IMPEDANCE_MOHM ? null : `must be above 0 and at most ${MAX_LOOP_IMPEDANCE_MOHM}`) },
};
const LOAD_SPEC: FieldSpec = {
  powerW: { required: true, check: (v) => (typeof v === 'number' && loadSpecProblem({ powerW: v }) === null ? null : `must be above 0 and at most ${MAX_POWER_W}`) },
  powerFactor: { required: false, check: (v) => (typeof v === 'number' && v >= MIN_POWER_FACTOR && v <= 1 ? null : `must be from ${MIN_POWER_FACTOR} to 1`) },
  method: { required: false, check: oneOf(INSTALL_METHODS) },
  crossSectionMm2: { required: false, check: oneOf(CROSS_SECTIONS_MM2) },
  lengthM: { required: false, check: (v) => (typeof v === 'number' && v > 0 && v <= MAX_CABLE_LENGTH_M ? null : `must be above 0 and at most ${MAX_CABLE_LENGTH_M}`) },
  circuit: { required: false, check: oneOf(CIRCUIT_KINDS) },
};
const routeProblemCheck = (v: unknown) => routeProblem(v);
const WIRE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  a: { required: true, check: terminalRefCheck },
  b: { required: true, check: terminalRefCheck },
  label: { required: false, check: labelCheck },
  crossSectionMm2: { required: false, check: oneOf(CROSS_SECTIONS_MM2) },
  route: { required: false, check: routeProblemCheck },
};

/** Module nodes take their terminals from the module; source and load nodes carry their own. */
function checkNodeShape(node: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  const isModule = node.kind === 'module';
  if (isModule && node.conductors !== undefined) {
    errors.push({ path: `${path}.conductors`, message: 'is not allowed on a module node' });
  }
  if (!isModule && node.conductors === undefined) {
    errors.push({ path: `${path}.conductors`, message: 'is required for source and load nodes' });
  }
  if (node.off !== undefined && node.kind !== 'source') errors.push({ path: `${path}.off`, message: 'is only allowed on a source node' });
  if (node.earthing !== undefined && node.kind !== 'source') errors.push({ path: `${path}.earthing`, message: 'is only allowed on a source node' });
  for (const key of ['shortCircuitKA', 'loopImpedanceMOhm']) {
    if (node[key] !== undefined && node.kind !== 'source') errors.push({ path: `${path}.${key}`, message: 'is only allowed on a source node' });
  }
  if (node.load !== undefined) {
    if (node.kind !== 'load') errors.push({ path: `${path}.load`, message: 'is only allowed on a load node' });
    else child(node, 'load', LOAD_SPEC, `${path}.load`, errors);
  }
  if (!isModule && node.placementId !== undefined) {
    errors.push({ path: `${path}.placementId`, message: 'is only allowed on a module node' });
  }
}

function child(parent: Record<string, unknown> | undefined, key: string, spec: FieldSpec, path: string, errors: ValidationError[]) {
  const value = parent?.[key];
  return isRecord(value) ? validateObject(value, spec, path, errors) : undefined;
}

function validateModules(raw: unknown, errors: ValidationError[]): Record<string, ModuleDef> {
  const modules: Record<string, ModuleDef> = {};
  if (!isRecord(raw)) return modules;
  for (const [key, value] of Object.entries(raw)) {
    const path = `modules["${key}"]`;
    const def = validateObject(value, MODULE_SPEC, path, errors);
    if (!def) continue;
    validateModuleDeep(def, path, errors);
    if (key.split('/').length !== 2 || !key.endsWith(`/${def.id as string}`)) {
      errors.push({ path, message: 'key must be "libraryId/moduleId" matching the module id' });
      continue;
    }
    modules[key] = def as unknown as ModuleDef;
  }
  return modules;
}

/** Everything wrong with a project that is still loadable: overlaps, orphans, bad wiring. */
export function projectWarnings(
  project: Project,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
  settings?: CableSettings,
): string[] {
  const widthOf = (item: { module: ModuleRef; widthUnits?: number }) =>
    item.widthUnits ?? resolve(item.module)?.widthUnits;
  const describe = (error: { kind: string; with?: string }) =>
    error.kind === 'overlap' ? `overlap with ${error.with}` : error.kind;
  const panel = findPanelProblems(project.panel, widthOf).map((p) => `placement ${p.placementId}: ${describe(p.error)}`);
  const combs = findCombProblems(project.panel, {
    widthOf,
    sideOf: (ref) => resolve(ref)?.comb?.side,
  }).map((p) => `comb ${p.combId}: ${describe(p.error)}`);
  const onShelf = (nodeId: string) => {
    const placementId = project.schematic.nodes.find((n) => n.id === nodeId)?.placementId;
    return project.panel.shelf.some((s) => s.id === placementId);
  };
  const schematic = findSchematicProblems(
    project.schematic,
    project.panel,
    nodeTerminalsLookup(project.panel, resolve),
  ).map((p) =>
    p.kind === 'orphan-module'
      ? `node ${p.nodeId}: its module is ${onShelf(p.nodeId) ? 'on the shelf' : 'not on the panel'}`
      : `wire ${p.wireId}: connects a missing node or terminal`,
  );
  const widths = [
    ...project.panel.placements.map((p) => ({ kind: 'placement', item: p })),
    ...project.panel.combs.map((c) => ({ kind: 'comb', item: c })),
    ...project.panel.shelf.map((s) => ({ kind: 'shelf item', item: s })),
  ].flatMap(({ kind, item }) => {
    if (item.widthUnits === undefined) return [];
    const allowed = resolve(item.module)?.resizable;
    if (!allowed) return [`${kind} ${item.id}: its module cannot be resized`];
    return item.widthUnits < allowed.minUnits || item.widthUnits > allowed.maxUnits
      ? [`${kind} ${item.id}: width ${item.widthUnits} is outside ${allowed.minUnits}-${allowed.maxUnits}`]
      : [];
  });
  const nets = findConnectionProblems(project, resolve).map((p) => p.message);
  return [...panel, ...combs, ...widths, ...schematic, ...nets, ...findRuleWarnings(project, resolve, settings), ...findGlue(project, resolve).map((f) => f.message)];
}

export function parseProjectFile(raw: unknown): ProjectParseResult {
  const errors: ValidationError[] = [];
  const root = validateObject(raw, ROOT_SPEC, '', errors);
  const project = child(root, 'project', PROJECT_SPEC, 'project', errors);
  const panelRaw = child(project, 'panel', PANEL_SPEC, 'project.panel', errors);
  const schematicRaw = child(project, 'schematic', SCHEMATIC_SPEC, 'project.schematic', errors);
  const placements = validateList<Placement>(panelRaw?.placements, PLACEMENT_SPEC, 'project.panel.placements', errors);
  const combs = validateList<CombPlacement>(panelRaw?.combs, COMB_PLACEMENT_SPEC, 'project.panel.combs', errors);
  const shelf = validateList<ShelfItem>(panelRaw?.shelf, SHELF_ITEM_SPEC, 'project.panel.shelf', errors);
  const placedIds = new Set(placements.map((p) => p.id));
  shelf.forEach((item, index) => {
    if (placedIds.has(item.id)) {
      errors.push({ path: `project.panel.shelf[${index}].id`, message: `duplicate id "${item.id}"` });
    }
  });
  const nodes = validateList<SchematicNode>(
    schematicRaw?.nodes,
    NODE_SPEC,
    'project.schematic.nodes',
    errors,
    checkNodeShape,
  );
  const wires = validateList<Wire>(schematicRaw?.wires, WIRE_SPEC, 'project.schematic.wires', errors);
  const modules = validateModules(root?.modules, errors);
  const railLengthsUnits = (panelRaw?.railLengthsUnits ?? []) as number[];
  const railPitchesMm = (panelRaw?.railPitchesMm ?? []) as number[];
  if (panelRaw && railPitchesMm.length !== railLengthsUnits.length - 1) {
    errors.push({
      path: 'project.panel.railPitchesMm',
      message: `must have one entry per gap between rails (${railLengthsUnits.length - 1})`,
    });
  }
  const railLabels = (panelRaw?.railLabels ?? []) as string[];
  if (panelRaw && railLabels.length !== railLengthsUnits.length) {
    errors.push({
      path: 'project.panel.railLabels',
      message: `must have one entry per rail (${railLengthsUnits.length})`,
    });
  }
  if (!root || !panelRaw || !schematicRaw || errors.length > 0) return { ok: false, errors };

  const parsed: Project = {
    panel: {
      ...(panelRaw.title !== undefined ? { title: panelRaw.title as string } : {}),
      ...(panelRaw.info !== undefined ? { info: panelRaw.info as ProjectInfo } : {}),
      ...(panelRaw.annotations !== undefined ? { annotations: panelRaw.annotations as Annotation[] } : {}),
      railLengthsUnits,
      railPitchesMm,
      railLabels,
      placements,
      combs,
      shelf,
    },
    schematic: { nodes, wires, ...(schematicRaw.annotations !== undefined ? { annotations: schematicRaw.annotations as Annotation[] } : {}) },
  };
  return {
    ok: true,
    file: { format: PROJECT_FORMAT, version: PROJECT_VERSION, project: parsed, modules },
    warnings: projectWarnings(parsed, (ref) => modules[moduleKey(ref)]),
  };
}

export function parseProjectJson(text: string): ProjectParseResult {
  try {
    return parseProjectFile(JSON.parse(text));
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
}
