import type { ModuleDef } from '../library/types';
import type { ModuleRef } from './placement';
import { buildProjectFile, moduleKey, type ProjectFile } from '../project/file';
import type { Project } from '../project';
import { nextId, type Schematic, type SchematicNode, type Wire } from '../schematic/model';
import { pasteItems } from './clipboard';
import { lookupsOf } from './lookups';
import { normalizeLabel } from './labels';
import type { Panel } from './placement';
import { roundUnits } from './units';

/** A group of modules, with the wires between them, kept to be put on a panel again. */
export interface Snippet {
  id: string;
  name: string;
  savedAt: number;
  /** The modules and the wiring between them as a small project of their own, with the module definitions. */
  file: ProjectFile;
}

export const MAX_SNIPPETS = 100;
/** How far to the right of the existing nodes the wiring of an inserted snippet is put. */
const NODE_GAP_MM = 240;

export type MakeSnippetError = 'empty' | 'bad-name' | 'too-many';
export type MakeSnippetResult = { ok: true; snippet: Snippet } | { ok: false; error: MakeSnippetError };

const snippetId = (existing: readonly Snippet[]): string => {
  const taken = new Set(existing.map((s) => s.id));
  for (let n = 1; ; n++) if (!taken.has(`snippet-${n}`)) return `snippet-${n}`;
};

/** The chosen modules and combs, moved to the corner of the panel, with the module nodes and wires among them. */
export function makeSnippet(
  project: Project,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
  chosen: { placementIds: readonly string[]; combIds: readonly string[] },
  name: string,
  now: number,
  existing: readonly Snippet[],
): MakeSnippetResult {
  const placements = project.panel.placements.filter((p) => chosen.placementIds.includes(p.id));
  const combs = project.panel.combs.filter((c) => chosen.combIds.includes(c.id));
  if (placements.length + combs.length === 0) return { ok: false, error: 'empty' };
  if (existing.length >= MAX_SNIPPETS) return { ok: false, error: 'too-many' };
  const label = normalizeLabel(name);
  if (!label.ok || label.label === undefined) return { ok: false, error: 'bad-name' };

  const items = [...placements, ...combs];
  const minRail = Math.min(...items.map((i) => i.rail));
  const maxRail = Math.max(...items.map((i) => i.rail));
  const minSlot = Math.min(...items.map((i) => i.slot));
  const moved = <T extends { rail: number; slot: number }>(item: T): T => ({ ...item, rail: item.rail - minRail, slot: roundUnits(item.slot - minSlot) });
  const source = project.panel;
  const panel: Panel = {
    railLengthsUnits: source.railLengthsUnits.slice(minRail, maxRail + 1),
    railPitchesMm: source.railPitchesMm.slice(minRail, maxRail),
    railLabels: source.railLabels.slice(minRail, maxRail + 1),
    placements: placements.map(moved),
    combs: combs.map(moved),
    shelf: [],
  };

  const kept = new Set(placements.map((p) => p.id));
  const nodes = project.schematic.nodes.filter((n) => n.kind === 'module' && n.placementId !== undefined && kept.has(n.placementId));
  const ids = new Set(nodes.map((n) => n.id));
  const left = nodes.length > 0 ? Math.min(...nodes.map((n) => n.x)) : 0;
  const top = nodes.length > 0 ? Math.min(...nodes.map((n) => n.y)) : 0;
  const schematic: Schematic = {
    nodes: nodes.map((n) => ({ ...n, x: n.x - left, y: n.y - top })),
    wires: project.schematic.wires.filter((w) => ids.has(w.a.node) && ids.has(w.b.node)).map(({ route: _route, ...wire }) => wire),
  };
  return {
    ok: true,
    snippet: { id: snippetId(existing), name: label.label, savedAt: now, file: buildProjectFile({ panel, schematic }, resolve) },
  };
}

export type InsertSnippetResult =
  | { ok: true; project: Project; snapshot: Record<string, ModuleDef>; placementIds: string[]; combIds: string[] }
  | { ok: false; error: 'no-room' };

/**
 * Puts a snippet on the panel at the nearest free place from `at`: its modules and combs with new ids, its
 * module nodes and wires with new ids to the right of the schematic, and the definitions of modules the project
 * does not know yet into the snapshot.
 */
export function insertSnippet(
  project: Project,
  snapshot: Record<string, ModuleDef>,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
  snippet: Snippet,
  at: { rail: number; slot: number },
): InsertSnippetResult {
  const { panel: part, schematic: wiring } = snippet.file.project;
  const nextSnapshot = { ...snapshot };
  for (const [key, def] of Object.entries(snippet.file.modules)) {
    const [libraryId, ...rest] = key.split('/');
    if (!resolve({ libraryId: libraryId ?? '', moduleId: rest.join('/') })) nextSnapshot[key] = def;
  }
  const knowing = (ref: ModuleRef): ModuleDef | undefined => resolve(ref) ?? nextSnapshot[moduleKey(ref)];
  const lookups = lookupsOf(knowing);

  const shifted = <T extends { rail: number; slot: number }>(item: T): T => ({ ...item, rail: item.rail + at.rail, slot: roundUnits(item.slot + at.slot) });
  const pasted = pasteItems(project.panel, lookups.widthOf, lookups.combLookup, { placements: part.placements.map(shifted), combs: part.combs.map(shifted) });
  if (!pasted.ok) return { ok: false, error: 'no-room' };

  const placementOf = new Map(part.placements.map((p, i) => [p.id, pasted.placementIds[i]!]));
  const right = project.schematic.nodes.length > 0 ? Math.max(...project.schematic.nodes.map((n) => n.x)) + NODE_GAP_MM : 0;
  const top = project.schematic.nodes.length > 0 ? Math.min(...project.schematic.nodes.map((n) => n.y)) : 0;
  let nodeNumber = Number(nextId('n', project.schematic.nodes).slice(1));
  const nodeOf = new Map<string, string>();
  const nodes: SchematicNode[] = wiring.nodes.map((node) => {
    const id = `n${nodeNumber++}`;
    nodeOf.set(node.id, id);
    return { ...node, id, x: node.x + right, y: node.y + top, placementId: placementOf.get(node.placementId ?? '') ?? node.placementId };
  });
  let wireNumber = Number(nextId('w', project.schematic.wires).slice(1));
  const wires: Wire[] = wiring.wires.map((wire) => ({
    ...wire,
    id: `w${wireNumber++}`,
    a: { ...wire.a, node: nodeOf.get(wire.a.node) ?? wire.a.node },
    b: { ...wire.b, node: nodeOf.get(wire.b.node) ?? wire.b.node },
  }));
  return {
    ok: true,
    project: { panel: pasted.panel, schematic: { nodes: [...project.schematic.nodes, ...nodes], wires: [...project.schematic.wires, ...wires] } },
    snapshot: nextSnapshot,
    placementIds: pasted.placementIds,
    combIds: pasted.combIds,
  };
}
