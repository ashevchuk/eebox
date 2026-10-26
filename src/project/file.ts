import {
  DEFAULT_RAIL_PITCH_MM,
  MAX_RAILS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../layout/limits';
import { findProblems as findPanelProblems, type ModuleRef, type Placement } from '../layout/placement';
import {
  MODULE_SPEC,
  identifier,
  isRecord,
  nonEmptyString,
  oneOf,
  railLengthsCheck,
  validateList,
  validateObject,
  type FieldSpec,
  type ValidationError,
} from '../library/validate';
import type { ModuleDef } from '../library/types';
import type { Project } from '../project';
import { findProblems as findSchematicProblems, type SchematicNode, type Wire } from '../schematic/model';

export const PROJECT_FORMAT = 'eebox-project';
export const PROJECT_VERSION = 1;
const NODE_KINDS = ['source', 'busbar', 'load', 'module'] as const;

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
  for (const placement of project.panel.placements) {
    const def = resolve(placement.module);
    if (def) modules[moduleKey(placement.module)] = def;
  }
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, project, modules };
}

const objectCheck = (v: unknown) => (isRecord(v) ? null : 'must be an object');
const arrayCheck = (v: unknown) => (Array.isArray(v) ? null : 'must be an array');
const nonNegativeInteger = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 ? null : 'must be a non-negative integer';
const finiteNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a finite number');
const pitchListCheck = (v: unknown) =>
  Array.isArray(v) &&
  v.length < MAX_RAILS &&
  v.every((n) => Number.isInteger(n) && n >= MIN_RAIL_PITCH_MM && n <= MAX_RAIL_PITCH_MM)
    ? null
    : `must be an array of whole numbers from ${MIN_RAIL_PITCH_MM} to ${MAX_RAIL_PITCH_MM} (mm)`;
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
  railLengthsUnits: { required: true, check: railLengthsCheck },
  railPitchesMm: { required: false, check: pitchListCheck },
  placements: { required: true, check: arrayCheck },
};
const PLACEMENT_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  module: { required: true, check: moduleRefCheck },
  rail: { required: true, check: nonNegativeInteger },
  slot: { required: true, check: nonNegativeInteger },
};
const SCHEMATIC_SPEC: FieldSpec = {
  nodes: { required: true, check: arrayCheck },
  wires: { required: true, check: arrayCheck },
};
const NODE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  kind: { required: true, check: oneOf(NODE_KINDS) },
  label: { required: true, check: nonEmptyString },
  x: { required: true, check: finiteNumber },
  y: { required: true, check: finiteNumber },
  placementId: { required: false, check: identifier },
};
const WIRE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  from: { required: true, check: identifier },
  to: { required: true, check: identifier },
};

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
    if (key.split('/').length !== 2 || !key.endsWith(`/${def.id as string}`)) {
      errors.push({ path, message: 'key must be "libraryId/moduleId" matching the module id' });
      continue;
    }
    modules[key] = def as unknown as ModuleDef;
  }
  return modules;
}

function warningsFor(project: Project, modules: Record<string, ModuleDef>): string[] {
  const widthOf = (ref: ModuleRef) => modules[moduleKey(ref)]?.widthUnits;
  const panel = findPanelProblems(project.panel, widthOf).map(
    (p) => `placement ${p.placementId}: ${p.error.kind}${p.error.kind === 'overlap' ? ` with ${p.error.with}` : ''}`,
  );
  const schematic = findSchematicProblems(project.schematic, project.panel).map((p) =>
    p.kind === 'orphan-module'
      ? `node ${p.nodeId}: its module is not on the panel`
      : `wire ${p.wireId}: connects a missing node`,
  );
  return [...panel, ...schematic];
}

export function parseProjectFile(raw: unknown): ProjectParseResult {
  const errors: ValidationError[] = [];
  const root = validateObject(raw, ROOT_SPEC, '', errors);
  const project = child(root, 'project', PROJECT_SPEC, 'project', errors);
  const panelRaw = child(project, 'panel', PANEL_SPEC, 'project.panel', errors);
  const schematicRaw = child(project, 'schematic', SCHEMATIC_SPEC, 'project.schematic', errors);
  const placements = validateList<Placement>(panelRaw?.placements, PLACEMENT_SPEC, 'project.panel.placements', errors);
  const nodes = validateList<SchematicNode>(schematicRaw?.nodes, NODE_SPEC, 'project.schematic.nodes', errors);
  const wires = validateList<Wire>(schematicRaw?.wires, WIRE_SPEC, 'project.schematic.wires', errors);
  const modules = validateModules(root?.modules, errors);
  const railLengthsUnits = (panelRaw?.railLengthsUnits ?? []) as number[];
  const railPitchesMm =
    (panelRaw?.railPitchesMm as number[] | undefined) ??
    railLengthsUnits.slice(1).map(() => DEFAULT_RAIL_PITCH_MM);
  if (panelRaw && railPitchesMm.length !== railLengthsUnits.length - 1) {
    errors.push({
      path: 'project.panel.railPitchesMm',
      message: `must have one entry per gap between rails (${railLengthsUnits.length - 1})`,
    });
  }
  if (!root || !panelRaw || !schematicRaw || errors.length > 0) return { ok: false, errors };

  const parsed: Project = {
    panel: { railLengthsUnits, railPitchesMm, placements },
    schematic: { nodes, wires },
  };
  return {
    ok: true,
    file: { format: PROJECT_FORMAT, version: PROJECT_VERSION, project: parsed, modules },
    warnings: warningsFor(parsed, modules),
  };
}

export function parseProjectJson(text: string): ProjectParseResult {
  try {
    return parseProjectFile(JSON.parse(text));
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
}
