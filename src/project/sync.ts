import { terminalsOf } from '../electrical/terminals';
import type { CombPlacement, ModuleRef, Placement, ShelfItem } from '../layout/placement';
import { stableStringify } from '../library/equality';
import type { ModuleDef } from '../library/types';
import type { Project } from '../project';
import { moduleKey, projectWarnings } from './file';

type Resolve = (ref: ModuleRef) => ModuleDef | undefined;
type Snapshot = Record<string, ModuleDef>;

export interface ModuleChange {
  key: string;
  name: string;
  /** Top-level fields of the definition that differ. */
  fields: string[];
}

export interface ModuleDifferences {
  changed: ModuleChange[];
  /** Modules the project uses that no library has any more. */
  missing: string[];
}

export interface UpdatePlan extends ModuleDifferences {
  project: Project;
  snapshot: Snapshot;
  droppedWires: number;
  /** Problems the new definitions cause, that the project did not have before. */
  newProblems: string[];
}

function differingFields(a: ModuleDef, b: ModuleDef): string[] {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((field) => stableStringify(left[field]) !== stableStringify(right[field]))
    .sort();
}

function usedModules(project: Project): Map<string, ModuleRef> {
  const used = new Map<string, ModuleRef>();
  for (const item of [...project.panel.placements, ...project.panel.combs, ...project.panel.shelf]) {
    used.set(moduleKey(item.module), item.module);
  }
  return used;
}

/**
 * Compares the definitions the project stored with the ones in the libraries now. Only modules the
 * project actually uses and has a stored copy of are looked at; others already follow the libraries.
 */
export function moduleDifferences(project: Project, snapshot: Snapshot, fromLibraries: Resolve): ModuleDifferences {
  const changed: ModuleChange[] = [];
  const missing: string[] = [];
  for (const [key, ref] of usedModules(project)) {
    const stored = snapshot[key];
    if (!stored) continue;
    const fresh = fromLibraries(ref);
    if (!fresh) missing.push(key);
    else if (stableStringify(stored) !== stableStringify(fresh)) changed.push({ key, name: fresh.name, fields: differingFields(stored, fresh) });
  }
  return { changed, missing };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Brings an own width back into what the new definition allows, and forgets labels of vanished terminals. */
function adjustWidth<T extends { widthUnits?: number }>(item: T, def: ModuleDef): T {
  if (item.widthUnits === undefined) return item;
  const { widthUnits: _old, ...rest } = item;
  if (!def.resizable) return rest as T;
  const width = clamp(item.widthUnits, def.resizable.minUnits, def.resizable.maxUnits);
  return width === def.widthUnits ? (rest as T) : { ...rest, widthUnits: width } as T;
}

function adjustPlacement<T extends Placement | ShelfItem>(item: T, def: ModuleDef): T {
  const resized = adjustWidth(item, def);
  if (!resized.terminalLabels) return resized;
  const known = new Set(terminalsOf(def, resized.widthUnits ?? def.widthUnits).map((t) => t.id));
  const kept = Object.fromEntries(Object.entries(resized.terminalLabels).filter(([id]) => known.has(id)));
  const { terminalLabels: _old, ...rest } = resized;
  return Object.keys(kept).length > 0 ? { ...rest, terminalLabels: kept } as T : (rest as T);
}

/**
 * Works out what taking the current library definitions over would do: the new stored definitions,
 * the project adjusted to them, the wires that lose their terminal, and the problems that appear.
 */
export function planModuleUpdate(project: Project, snapshot: Snapshot, fromLibraries: Resolve): UpdatePlan {
  const { changed, missing } = moduleDifferences(project, snapshot, fromLibraries);
  if (changed.length === 0) return { changed, missing, project, snapshot, droppedWires: 0, newProblems: [] };

  const refs = usedModules(project);
  const changedKeys = new Set(changed.map((c) => c.key));
  const nextSnapshot: Snapshot = { ...snapshot };
  for (const key of changedKeys) nextSnapshot[key] = fromLibraries(refs.get(key)!)!;

  const defOf = (key: string) => nextSnapshot[key]!;
  const { panel, schematic } = project;
  const placements = panel.placements.map((p) => (changedKeys.has(moduleKey(p.module)) ? adjustPlacement(p, defOf(moduleKey(p.module))) : p));
  const combs = panel.combs.map((c: CombPlacement) => (changedKeys.has(moduleKey(c.module)) ? adjustWidth(c, defOf(moduleKey(c.module))) : c));
  const shelf = panel.shelf.map((s) => (changedKeys.has(moduleKey(s.module)) ? adjustPlacement(s, defOf(moduleKey(s.module))) : s));

  const lostTerminals = new Map<string, Set<string>>();
  [...panel.placements, ...panel.shelf].forEach((before) => {
    const key = moduleKey(before.module);
    if (!changedKeys.has(key)) return;
    const after = [...placements, ...shelf].find((p) => p.id === before.id)!;
    const oldDef = snapshot[key]!;
    const newIds = new Set(terminalsOf(defOf(key), after.widthUnits ?? defOf(key).widthUnits).map((t) => t.id));
    const lost = terminalsOf(oldDef, before.widthUnits ?? oldDef.widthUnits).map((t) => t.id).filter((id) => !newIds.has(id));
    if (lost.length > 0) lostTerminals.set(before.id, new Set(lost));
  });
  const lostOnNode = (ref: { node: string; terminal: string }) => {
    const placementId = schematic.nodes.find((n) => n.id === ref.node)?.placementId;
    return placementId !== undefined && (lostTerminals.get(placementId)?.has(ref.terminal) ?? false);
  };
  const wires = schematic.wires.filter((w) => !lostOnNode(w.a) && !lostOnNode(w.b));

  const nextProject: Project = { panel: { ...panel, placements, combs, shelf }, schematic: { ...schematic, wires } };
  const before = new Set(projectWarnings(project, (ref) => snapshot[moduleKey(ref)] ?? fromLibraries(ref)));
  const newProblems = projectWarnings(nextProject, (ref) => nextSnapshot[moduleKey(ref)] ?? fromLibraries(ref)).filter(
    (message) => !before.has(message),
  );
  return {
    changed,
    missing,
    project: nextProject,
    snapshot: nextSnapshot,
    droppedWires: schematic.wires.length - wires.length,
    newProblems,
  };
}

/**
 * Makes a placed module use another definition, as a design made from a bundled device does: the
 * terminals that the new definition lacks lose their wires, the width is brought back into its range,
 * and the problems that appear are listed. The schematic node of the module stays, so the rest of
 * the wiring is kept.
 */
export function planModuleSwap(project: Project, snapshot: Snapshot, placementId: string, ref: ModuleRef, def: ModuleDef, resolve: Resolve): UpdatePlan {
  const placement = project.panel.placements.find((p) => p.id === placementId);
  const nothing: UpdatePlan = { changed: [], missing: [], project, snapshot, droppedWires: 0, newProblems: [] };
  if (!placement) return nothing;
  const before = resolve(placement.module);
  const nextSnapshot: Snapshot = { ...snapshot, [moduleKey(ref)]: def };
  const moved = adjustPlacement({ ...placement, module: ref }, def);
  const kept = new Set(terminalsOf(def, moved.widthUnits ?? def.widthUnits).map((t) => t.id));
  const lost = new Set(before ? terminalsOf(before, placement.widthUnits ?? before.widthUnits).map((t) => t.id).filter((id) => !kept.has(id)) : []);
  const node = project.schematic.nodes.find((n) => n.placementId === placementId);
  const lostOnNode = (end: { node: string; terminal: string }) => node !== undefined && end.node === node.id && lost.has(end.terminal);
  const wires = project.schematic.wires.filter((w) => !lostOnNode(w.a) && !lostOnNode(w.b));
  const nextProject: Project = {
    panel: { ...project.panel, placements: project.panel.placements.map((p) => (p.id === placementId ? moved : p)) },
    schematic: { ...project.schematic, wires },
  };
  const warnings = new Set(projectWarnings(project, (r) => snapshot[moduleKey(r)] ?? resolve(r)));
  const newProblems = projectWarnings(nextProject, (r) => nextSnapshot[moduleKey(r)] ?? resolve(r)).filter((message) => !warnings.has(message));
  return { changed: [{ key: moduleKey(ref), name: def.name, fields: before ? differingFields(before, def) : [] }], missing: [], project: nextProject, snapshot: nextSnapshot, droppedWires: project.schematic.wires.length - wires.length, newProblems };
}
