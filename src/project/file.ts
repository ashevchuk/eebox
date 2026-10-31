import { annotationsCheck, type Annotation } from '../layout/annotations';
import { infoCheck, type ProjectInfo } from '../layout/info';
import { findConnectionProblems, findGlue } from '../electrical/problems';
import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import { CROSS_SECTIONS_MM2, INSTALL_METHODS, type CableSettings } from '../electrical/cables';
import { EARTHING_SYSTEM_IDS } from '../electrical/earthing';
import { CIRCUIT_KINDS, loadSpecProblem, MAX_CABLE_LENGTH_M, MAX_POWER_W, MIN_POWER_FACTOR } from '../electrical/loads';
import { findRuleWarnings, ownerName } from '../electrical/rules';
import {
  DEFAULT_WIRE_SLACK_MM,
  MAX_CLEARANCE_MM,
  MAX_WIRE_SLACK_MM,
  MAX_PLATES,
  MAX_PLATE_SIZE_MM,
  MIN_PLATE_SIZE_MM,
  MAX_DUCTS,
  MAX_DUCT_SIZE_MM,
  MIN_DUCT_SIZE_MM,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_POSITION_MM,
} from '../layout/limits';
import type { Duct } from '../layout/ducts';
import { railsAreGrouped } from '../layout/plates';
import type { Rail } from '../layout/rail';
import { findCombProblems } from '../layout/combs';
import { lookupsOf } from '../layout/lookups';
import { findDuctFillFindings } from '../electrical/ductFill';
import { findPlacementFindings } from '../layout/placementFindings';
import {
  findProblems as findPanelProblems,
  isFree,
  type CombPlacement,
  type Panel,
  type Plate,
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
  validateEntries,
  validateList,
  validateObject,
  type FieldSpec,
  type ValidationError,
} from '../library/validate';
import { CONDUCTORS, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { MAX_LOOP_IMPEDANCE_MOHM, MAX_SHORT_CIRCUIT_KA, routeProblem, findProblems as findSchematicProblems, type SchematicNode, type Wire } from '../schematic/model';

import { GENERATOR, generatorCheck } from '../generator';

export const PROJECT_FORMAT = 'eebox-project';
export const PROJECT_VERSION = 1;
const NODE_KINDS = ['source', 'load', 'module'] as const;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  /** The application that wrote the file, as `eebox 0.7.0`; files from before it was written lack it. */
  generator?: string;
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
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, generator: GENERATOR, project, modules };
}

const objectCheck = (v: unknown) => (isRecord(v) ? null : 'must be an object');
const arrayCheck = (v: unknown) => (Array.isArray(v) ? null : 'must be an array');
const nonNegativeInteger = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 ? null : 'must be a non-negative integer';
const slotCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_LENGTH_UNITS ? null : `must be a number of units from 0 to ${MAX_RAIL_LENGTH_UNITS}`;
const unitsCheck = widthCheck;
const finiteNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a finite number');
const clearanceCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_CLEARANCE_MM ? null : `must be above 0 and at most ${MAX_CLEARANCE_MM} (mm), or left out`;
const wireSlackCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_WIRE_SLACK_MM && v !== DEFAULT_WIRE_SLACK_MM ? null : `must be 0 to ${MAX_WIRE_SLACK_MM} (mm) and not ${DEFAULT_WIRE_SLACK_MM}, which is left out`;
const railPositionCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_POSITION_MM ? null : `must be a number of mm from 0 to ${MAX_RAIL_POSITION_MM}`;
const railLengthCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= MAX_RAIL_LENGTH_UNITS ? null : `must be a number of units from 1 to ${MAX_RAIL_LENGTH_UNITS}`;
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
const plateSizeCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_PLATE_SIZE_MM && v <= MAX_PLATE_SIZE_MM ? null : `must be a number of mm from ${MIN_PLATE_SIZE_MM} to ${MAX_PLATE_SIZE_MM}`;
const PLATE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  name: { required: true, check: labelCheck },
  widthMm: { required: true, check: plateSizeCheck },
  heightMm: { required: true, check: plateSizeCheck },
  annotations: { required: false, check: annotationsCheck },
};
const RAIL_SPEC: FieldSpec = {
  plate: { required: true, check: identifier },
  x: { required: true, check: railPositionCheck },
  y: { required: true, check: railPositionCheck },
  lengthUnits: { required: true, check: railLengthCheck },
  label: { required: false, check: labelCheck },
};
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
  generator: { required: false, check: generatorCheck },
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
  plates: { required: true, check: arrayCheck },
  rails: { required: true, check: arrayCheck },
  ducts: { required: false, check: arrayCheck },
  clearanceMm: { required: false, check: clearanceCheck },
  wireSlackMm: { required: false, check: wireSlackCheck },
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
  id: { required: true, check: identifier },
  module: { required: true, check: moduleRefCheck },
  rail: { required: false, check: nonNegativeInteger },
  slot: { required: false, check: slotCheck },
  x: { required: false, check: railPositionCheck },
  y: { required: false, check: railPositionCheck },
  plate: { required: false, check: identifier },
  label: { required: false, check: labelCheck },
  widthUnits: { required: false, check: unitsCheck },
  terminalLabels: { required: false, check: terminalLabelsCheck },
  state: { required: false, check: oneOf(STATES) },
  flags: { required: false, check: flagsCheck },
};
/** A device stands on a rail (rail and slot) or on the plate (x and y), and not both. */
function placementPositionCheck(item: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  const onRail = item.rail !== undefined || item.slot !== undefined;
  const onPlate = item.x !== undefined || item.y !== undefined;
  const complete = onRail ? item.rail !== undefined && item.slot !== undefined && item.plate === undefined : item.x !== undefined && item.y !== undefined && item.plate !== undefined;
  if (onRail === onPlate || !complete) errors.push({ path, message: 'must have a rail and a slot, or a plate, an x and a y, and not both' });
}
const ductSizeCheck = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_DUCT_SIZE_MM && v <= MAX_DUCT_SIZE_MM ? null : `must be a number of mm from ${MIN_DUCT_SIZE_MM} to ${MAX_DUCT_SIZE_MM}`;
const DUCT_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  plate: { required: true, check: identifier },
  x: { required: true, check: railPositionCheck },
  y: { required: true, check: railPositionCheck },
  widthMm: { required: true, check: ductSizeCheck },
  heightMm: { required: true, check: ductSizeCheck },
  depthMm: { required: false, check: ductSizeCheck },
  label: { required: false, check: labelCheck },
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
  duct: { required: false, check: identifier },
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
  const placed = findPlacementFindings(project, lookupsOf(resolve).sizes, resolve).map((f) => f.message);
  return [...panel, ...combs, ...widths, ...schematic, ...nets, ...findRuleWarnings(project, resolve, settings), ...findGlue(project, resolve).map((f) => f.message), ...placed, ...findDuctFillFindings(project, resolve).map((f) => f.message)];
}

export function parseProjectFile(raw: unknown): ProjectParseResult {
  const errors: ValidationError[] = [];
  const root = validateObject(raw, ROOT_SPEC, '', errors);
  const project = child(root, 'project', PROJECT_SPEC, 'project', errors);
  const panelRaw = child(project, 'panel', PANEL_SPEC, 'project.panel', errors);
  const schematicRaw = child(project, 'schematic', SCHEMATIC_SPEC, 'project.schematic', errors);
  const placements = validateList<Placement>(panelRaw?.placements, PLACEMENT_SPEC, 'project.panel.placements', errors, placementPositionCheck);
  const ducts = validateList<Duct>(panelRaw?.ducts, DUCT_SPEC, 'project.panel.ducts', errors);
  if (panelRaw && Array.isArray(panelRaw.ducts) && (panelRaw.ducts.length < 1 || panelRaw.ducts.length > MAX_DUCTS)) {
    errors.push({ path: 'project.panel.ducts', message: `must list 1 to ${MAX_DUCTS} ducts, or be left out` });
  }
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
  const rails = validateEntries<Rail>(panelRaw?.rails, RAIL_SPEC, 'project.panel.rails', errors);
  if (panelRaw && Array.isArray(panelRaw.rails) && panelRaw.rails.length > MAX_RAILS) {
    errors.push({ path: 'project.panel.rails', message: `must list at most ${MAX_RAILS} rails` });
  }
  const plates = validateList<Plate>(panelRaw?.plates, PLATE_SPEC, 'project.panel.plates', errors);
  if (panelRaw && Array.isArray(panelRaw.plates) && (panelRaw.plates.length < 1 || panelRaw.plates.length > MAX_PLATES)) {
    errors.push({ path: 'project.panel.plates', message: `must list 1 to ${MAX_PLATES} plates` });
  }
  plates.forEach((p, i) => plates.findIndex((q) => q.name === p.name) !== i && errors.push({ path: `project.panel.plates[${i}].name`, message: `another plate has the name "${p.name}"` }));
  if (errors.length === 0) {
    const known = new Set(plates.map((p) => p.id));
    rails.forEach((r, i) => known.has(r.plate) || errors.push({ path: `project.panel.rails[${i}].plate`, message: `unknown plate "${r.plate}"` }));
    ducts.forEach((d, i) => known.has(d.plate) || errors.push({ path: `project.panel.ducts[${i}].plate`, message: `unknown plate "${d.plate}"` }));
    const ductIds = new Set(ducts.map((d) => d.id));
    wires.forEach((w, i) => w.duct === undefined || ductIds.has(w.duct) || errors.push({ path: `project.schematic.wires[${i}].duct`, message: `unknown duct "${w.duct}"` }));
    placements.forEach((p, i) => isFree(p) && !known.has(p.plate) && errors.push({ path: `project.panel.placements[${i}].plate`, message: `unknown plate "${p.plate}"` }));
    if (errors.length === 0 && !railsAreGrouped({ plates, rails } as Panel)) {
      errors.push({ path: 'project.panel.rails', message: 'must be listed plate by plate, in the order of the plates' });
    }
  }
  if (!root || !panelRaw || !schematicRaw || errors.length > 0) return { ok: false, errors };

  const parsed: Project = {
    panel: {
      ...(panelRaw.title !== undefined ? { title: panelRaw.title as string } : {}),
      ...(panelRaw.info !== undefined ? { info: panelRaw.info as ProjectInfo } : {}),
      plates,
      rails,
      ...(panelRaw.ducts !== undefined ? { ducts } : {}),
      ...(panelRaw.clearanceMm !== undefined ? { clearanceMm: panelRaw.clearanceMm as number } : {}),
      ...(panelRaw.wireSlackMm !== undefined ? { wireSlackMm: panelRaw.wireSlackMm as number } : {}),
      placements,
      combs,
      shelf,
    },
    schematic: { nodes, wires, ...(schematicRaw.annotations !== undefined ? { annotations: schematicRaw.annotations as Annotation[] } : {}) },
  };
  return {
    ok: true,
    file: { format: PROJECT_FORMAT, version: PROJECT_VERSION, ...(root.generator !== undefined ? { generator: root.generator as string } : {}), project: parsed, modules },
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
